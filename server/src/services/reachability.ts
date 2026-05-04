const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  timestamp: number;
  result: ReachabilityResult;
}

export interface ReachabilityResult {
  reachable: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

const cache = new Map<string, CacheEntry>();

async function checkSingle(url: string, timeoutMs: number): Promise<ReachabilityResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    return {
      reachable: res.status < 500,
      statusCode: res.status,
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { reachable: false, latencyMs: Date.now() - start, error: 'Timeout' };
    }
    return { reachable: false, latencyMs: Date.now() - start, error: msg };
  }
}

export async function checkReachability(
  targets: Array<{ upstream: string; url?: string; tls_mode?: string }>,
  timeoutMs = 5000,
): Promise<Map<string, ReachabilityResult>> {
  const now = Date.now();
  const results = new Map<string, ReachabilityResult>();
  const toFetch: Array<{ key: string; url: string }> = [];

  for (const t of targets) {
    const checkUrl = t.upstream;
    if (!checkUrl) continue;
    const key = checkUrl;
    const cached = cache.get(key);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      results.set(key, cached.result);
    } else {
      let resolvedUrl = checkUrl;
      if (!/^https?:\/\//i.test(resolvedUrl)) {
        resolvedUrl = `http://${resolvedUrl}`;
      }
      toFetch.push({ key, url: resolvedUrl });
    }
  }

  if (toFetch.length > 0) {
    const fresh = await Promise.all(
      toFetch.map(async (t) => {
        const result = await checkSingle(t.url, timeoutMs);
        cache.set(t.key, { timestamp: Date.now(), result });
        return { key: t.key, result };
      }),
    );
    for (const { key, result } of fresh) {
      results.set(key, result);
    }
  }

  return results;
}