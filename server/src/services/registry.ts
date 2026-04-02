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

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ImageUpdateResult {
  hasUpdate: boolean;
  localDigest: string | null;
  remoteDigest: string | null;
  error?: string;
}

export async function checkImageUpdate(image: string): Promise<ImageUpdateResult> {
  const [localDigest, remoteDigest] = await Promise.all([
    getLocalDigest(image),
    getRemoteDigest(image),
  ]);

  if (!remoteDigest) {
    return { hasUpdate: false, localDigest, remoteDigest: null, error: 'Could not fetch remote digest' };
  }
  if (!localDigest) {
    // Image not yet pulled locally — treat as no update needed
    return { hasUpdate: false, localDigest: null, remoteDigest, error: 'Image not found locally' };
  }

  return { hasUpdate: localDigest !== remoteDigest, localDigest, remoteDigest };
}
