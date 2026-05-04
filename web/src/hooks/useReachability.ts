import { useState, useCallback, useRef } from 'react';
import { api, type ReachabilityResult } from '../api';

export function useReachability() {
  const [results, setResults] = useState<Map<string, ReachabilityResult>>(new Map());
  const checkingRef = useRef(false);

  const check = useCallback(async (targets: Array<{ upstream: string; url?: string; tls_mode?: string }>) => {
    if (targets.length === 0) return;
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const data = await api.proxy.checkReachability(targets);
      const map = new Map<string, ReachabilityResult>();
      for (const [key, val] of Object.entries(data.results)) {
        map.set(key, val as ReachabilityResult);
      }
      setResults(map);
    } catch {
      // Silently fail — reachability is best-effort
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const checkProxyHosts = useCallback(async (hosts: Array<{ id: number; domain: string; upstream: string; enabled: boolean; tls_mode: string }>) => {
    const enabledHosts = hosts.filter(h => h.enabled);
    if (enabledHosts.length === 0) {
      setResults(new Map());
      return;
    }
    const targets = enabledHosts.map(h => ({ upstream: h.upstream }));
    await check(targets);
  }, [check]);

  return { results, check, checkProxyHosts };
}