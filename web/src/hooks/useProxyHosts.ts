import { useState, useEffect, useCallback } from 'react';
import { api, type ProxyHost, type ProxyHostInput } from '../api';

export function useProxyHosts(projectId?: number) {
  const [hosts, setHosts] = useState<ProxyHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHosts = useCallback(async () => {
    try {
      setError(null);
      const data = await api.proxy.list(projectId);
      setHosts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch proxy hosts');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  const createHost = async (data: ProxyHostInput) => {
    const result = await api.proxy.create(data);
    if (result.success && result.host) {
      setHosts(prev => [...prev, result.host]);
    }
    return result;
  };

  const updateHost = async (id: number, data: Partial<ProxyHostInput>) => {
    const result = await api.proxy.update(id, data);
    if (result.success && result.host) {
      setHosts(prev => prev.map(h => h.id === id ? result.host : h));
    }
    return result;
  };

  const deleteHost = async (id: number) => {
    const result = await api.proxy.delete(id);
    if (result.success) {
      setHosts(prev => prev.filter(h => h.id !== id));
    }
    return result;
  };

  const toggleHost = async (id: number) => {
    const host = hosts.find(h => h.id === id);
    if (!host) return;
    return updateHost(id, { enabled: !host.enabled });
  };

  return {
    hosts,
    loading,
    error,
    refetch: fetchHosts,
    createHost,
    updateHost,
    deleteHost,
    toggleHost,
  };
}
