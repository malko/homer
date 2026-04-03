import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Image ref parsing ────────────────────────────────────────────────────────

interface ImageRef {
  /** API host, e.g. registry-1.docker.io */
  registry: string;
  /** Namespace + name, e.g. library/nginx or owner/image */
  repository: string;
  /** Tag, e.g. latest */
  tag: string;
}

export function parseImageRef(image: string): ImageRef {
  // Strip digest suffix (image@sha256:...)
  const atIdx = image.indexOf('@');
  if (atIdx !== -1) image = image.slice(0, atIdx);

  // Split off tag — last colon that's not inside a registry host with port
  let tag = 'latest';
  const slashIdx = image.indexOf('/');
  const colonIdx = image.lastIndexOf(':');
  if (colonIdx !== -1 && (slashIdx === -1 || colonIdx > slashIdx)) {
    // Make sure it's not a port (e.g. localhost:5000/image)
    const possibleTag = image.slice(colonIdx + 1);
    if (!possibleTag.includes('/')) {
      tag = possibleTag;
      image = image.slice(0, colonIdx);
    }
  }

  // Split registry from repository
  let registry = '';
  let repository = image;
  const firstSlash = image.indexOf('/');
  if (firstSlash !== -1) {
    const firstSegment = image.slice(0, firstSlash);
    // A segment is a registry if it contains a dot, a colon (port), or is 'localhost'
    if (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost') {
      registry = firstSegment;
      repository = image.slice(firstSlash + 1);
    }
  }

  // Default to Docker Hub
  if (!registry) {
    // Single name like "nginx" → "library/nginx"
    if (!repository.includes('/')) {
      repository = `library/${repository}`;
    }
    return { registry: 'registry-1.docker.io', repository, tag };
  }

  return { registry, repository, tag };
}

// ─── Auth token cache ─────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

async function getToken(ref: ImageRef): Promise<string | null> {
  const cacheKey = `${ref.registry}/${ref.repository}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  if (ref.registry === 'registry-1.docker.io') {
    // Docker Hub anonymous pull token
    const url = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${ref.repository}:pull`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const data = await resp.json() as { token?: string; expires_in?: number };
      if (!data.token) return null;
      const expiresIn = ((data.expires_in ?? 300) - 10) * 1000;
      tokenCache.set(cacheKey, { token: data.token, expiresAt: Date.now() + expiresIn });
      return data.token;
    } catch {
      return null;
    }
  }

  // Generic OCI auth: probe the registry to get WWW-Authenticate challenge
  try {
    const probeUrl = `https://${ref.registry}/v2/`;
    const probe = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
    if (probe.status === 401) {
      const wwwAuth = probe.headers.get('WWW-Authenticate') ?? '';
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
      if (realmMatch) {
        const tokenUrl = new URL(realmMatch[1]);
        tokenUrl.searchParams.set('scope', `repository:${ref.repository}:pull`);
        if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1]);
        const tokenResp = await fetch(tokenUrl.toString(), { signal: AbortSignal.timeout(10000) });
        if (!tokenResp.ok) return null;
        const data = await tokenResp.json() as { token?: string; access_token?: string; expires_in?: number };
        const token = data.token ?? data.access_token ?? '';
        if (!token) return null;
        const expiresIn = ((data.expires_in ?? 300) - 10) * 1000;
        tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn });
        return token;
      }
    }
    // No auth required
    if (probe.ok || probe.status === 200) {
      tokenCache.set(cacheKey, { token: '', expiresAt: Date.now() + 300_000 });
      return '';
    }
  } catch {}

  return null;
}

// ─── Remote digest ────────────────────────────────────────────────────────────

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
].join(', ');

export async function getRemoteDigest(image: string): Promise<string | null> {
  try {
    const ref = parseImageRef(image);
    const token = await getToken(ref);
    if (token === null) return null;

    const url = `https://${ref.registry}/v2/${ref.repository}/manifests/${ref.tag}`;
    const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;

    return resp.headers.get('Docker-Content-Digest');
  } catch {
    return null;
  }
}

// ─── Local digest ─────────────────────────────────────────────────────────────

export async function getLocalDigest(image: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format='{{index .RepoDigests 0}}' "${image}"`,
      { timeout: 10000 }
    );
    const line = stdout.trim().replace(/^'|'$/g, '');
    if (!line || line === '<no value>') return null;
    // Format: nginx@sha256:abc... → extract sha256:...
    const atIdx = line.indexOf('@');
    return atIdx !== -1 ? line.slice(atIdx + 1) : line;
  } catch {
    return null;
  }
}

// ─── Semver helpers ───────────────────────────────────────────────────────────

interface Semver { major: number; minor: number; patch: number; suffix: string }

function parseSemver(tag: string): Semver | null {
  // Support: 1.2.3, v1.2.3, 1.2 (patch = 0), 1 (minor = patch = 0)
  // Support variant suffixes like -alpine, -slim, -bullseye
  // Reject true pre-release tags like -rc1, -alpha2, -beta3 (letter + digit combo)
  const m = tag.replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-.*)?$/);
  if (!m) return null;
  const suffix = m[4] ?? '';
  if (suffix && /[a-zA-Z]/.test(suffix) && /\d/.test(suffix)) return null;
  return {
    major: parseInt(m[1]),
    minor: m[2] !== undefined ? parseInt(m[2]) : 0,
    patch: m[3] !== undefined ? parseInt(m[3]) : 0,
    suffix,
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

// ─── Remote tag listing ───────────────────────────────────────────────────────

async function listRemoteTags(ref: ImageRef, token: string | null): Promise<string[]> {
  const url = `https://${ref.registry}/v2/${ref.repository}/tags/list`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    const data = await resp.json() as { tags?: string[] };
    return data.tags ?? [];
  } catch {
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ImageUpdateResult {
  hasUpdate: boolean;
  localDigest: string | null;
  remoteDigest: string | null;
  targetTag?: string;
  error?: string;
}

export type AutoUpdatePolicy = 'disabled' | 'all' | 'semver_minor' | 'semver_patch';

export async function checkImageUpdate(image: string): Promise<ImageUpdateResult> {
  const [localDigest, remoteDigest] = await Promise.all([
    getLocalDigest(image),
    getRemoteDigest(image),
  ]);

  if (!remoteDigest) {
    return { hasUpdate: false, localDigest, remoteDigest: null, error: 'Could not fetch remote digest' };
  }
  if (!localDigest) {
    return { hasUpdate: false, localDigest: null, remoteDigest, error: 'Image not found locally' };
  }

  return { hasUpdate: localDigest !== remoteDigest, localDigest, remoteDigest };
}

/** Check for updates respecting a semver policy.
 *  For 'all': simple digest comparison (same as checkImageUpdate).
 *  For semver policies: find the highest tag matching the constraint and compare digests.
 *  Falls back to 'all' behaviour if the current tag is not valid semver.
 */
export async function checkImageUpdateWithPolicy(image: string, policy: AutoUpdatePolicy): Promise<ImageUpdateResult> {
  if (policy === 'disabled') return { hasUpdate: false, localDigest: null, remoteDigest: null };
  if (policy === 'all') return checkImageUpdate(image);

  const ref = parseImageRef(image);
  const currentSemver = parseSemver(ref.tag);
  if (!currentSemver) {
    // Non-semver tag (e.g. 'latest') — fall back to digest comparison
    return checkImageUpdate(image);
  }

  const token = await getToken(ref);
  if (token === null) return { hasUpdate: false, localDigest: null, remoteDigest: null, error: 'Auth failed' };

  const allTags = await listRemoteTags(ref, token);

  const compatible = allTags
    .flatMap(t => { const sv = parseSemver(t); return sv ? [{ tag: t, sv }] : []; })
    .filter(({ sv }) => {
      if (sv.suffix !== currentSemver.suffix) return false; // same variant only (e.g. -alpine)
      if (policy === 'semver_minor') return sv.major === currentSemver.major;
      if (policy === 'semver_patch') return sv.major === currentSemver.major && sv.minor === currentSemver.minor;
      return true;
    })
    .sort((a, b) => compareSemver(b.sv, a.sv));

  if (compatible.length === 0) return checkImageUpdate(image);

  const bestTag = compatible[0].tag;

  // Build the image reference for the target tag
  let targetImage: string;
  if (ref.registry === 'registry-1.docker.io') {
    const repoName = ref.repository.startsWith('library/')
      ? ref.repository.slice(8)
      : ref.repository;
    targetImage = `${repoName}:${bestTag}`;
  } else {
    targetImage = `${ref.registry}/${ref.repository}:${bestTag}`;
  }

  const localDigest = await getLocalDigest(image);
  const remoteDigest = bestTag === ref.tag
    ? await getRemoteDigest(image)
    : await getRemoteDigest(targetImage);

  if (!remoteDigest) return { hasUpdate: false, localDigest, remoteDigest: null, error: 'Could not fetch remote digest', targetTag: bestTag };
  if (!localDigest) return { hasUpdate: false, localDigest: null, remoteDigest, error: 'Image not found locally', targetTag: bestTag };

  return {
    hasUpdate: localDigest !== remoteDigest || bestTag !== ref.tag,
    localDigest,
    remoteDigest,
    targetTag: bestTag !== ref.tag ? bestTag : undefined,
  };
}
