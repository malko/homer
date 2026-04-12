const API_BASE = '/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('token');
  console.log(`[API] ${options.method || 'GET'} ${path} - Token:`, token ? 'present' : 'missing');
  
  const headers = new Headers();
  
  const hasBody = options.body && options.method !== 'GET' && options.method !== 'DELETE';
  if (hasBody) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (options.headers) {
    const extraHeaders = options.headers as Record<string, string>;
    Object.entries(extraHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  
  console.log(`[API] ${path} - Status: ${response.status}`);
  
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(response.status, body.error || 'Request failed');
  }
  
  return response.json();
}

export interface AuthStatus {
  needsSetup: boolean;
  mustChangePassword: boolean;
  authenticated?: boolean;
  username?: string;
}

export interface LoginResponse {
  token: string;
  username: string;
  mustChangePassword: boolean;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead';
  project?: string;
  service?: string;
  created: string;
  ports?: string[];
  update_available?: boolean;
  hasUpdate?: boolean;
}

export type AutoUpdatePolicy = 'disabled' | 'all' | 'semver_minor' | 'semver_patch';

export interface Project {
  id: number;
  name: string;
  path: string;
  env_path: string | null;
  url: string | null;
  icon: string | null;
  auto_update: boolean;
  auto_update_policy: AutoUpdatePolicy;
  watch_enabled: boolean;
  update_available?: boolean;
  created_at: string;
  containers: Container[];
  allRunning: boolean;
  anyRunning: boolean;
}

export interface ParsedService {
  name: string;
  image: string;
  ports: Array<{ host: string; container: string }>;
  volumes: Array<{ host: string; container: string; readonly?: boolean }>;
  environment: Record<string, string>;
  envFileVars: string[];
  restart: string;
  command: string[];
  networks: string[];
  depends_on: string[];
  labels: Record<string, string>;
  gpus?: string;
  privileged?: boolean;
  capAdd?: string[];
  capDrop?: string[];
  extra_hosts?: string[];
}

export interface ParseWarnings {
  unsupported: string[];
  skipped: string[];
}

export interface StandaloneContainer {
  id: string;
  name: string;
  image: string;
  command: string;
  created: string;
  status: string;
  ports: string;
  hasGpu?: boolean;
}

export interface ContainerDecision {
  containerId: string;
  containerName: string;
  type: 'gpu' | 'privileged' | 'capability';
  current: string;
  message: string;
  enabled: boolean;
}

export const api = {
  auth: {
    status: () => request<AuthStatus>('/auth/status'),
    setup: (username: string, password: string) =>
      request<LoginResponse>('/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    login: (username: string, password: string) =>
      request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    changePassword: (newPassword: string, currentPassword?: string) =>
      request<{ success: boolean }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword, currentPassword }),
      }),
    logout: () =>
      request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  },

  projects: {
    list: () => request<Project[]>('/projects'),
    get: (id: number) => request<Project>(`/projects/${id}`),
    create: (data: { name: string; autoUpdate?: boolean; autoUpdatePolicy?: AutoUpdatePolicy; watchEnabled?: boolean }) =>
      request<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: ProjectUpdatePayload) =>
      request<Project>(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: number, options?: { composeDown?: boolean; removeVolumes?: boolean; deleteFiles?: boolean }) => {
      const params = new URLSearchParams();
      if (options?.composeDown)   params.set('composeDown', '1');
      if (options?.removeVolumes) params.set('removeVolumes', '1');
      if (options?.deleteFiles)   params.set('deleteFiles', '1');
      const qs = params.toString() ? `?${params.toString()}` : '';
      return request<{ success: boolean; output?: string }>(`/projects/${id}${qs}`, { method: 'DELETE' });
    },
    deploy: (id: number) =>
      request<{ success: boolean; output: string }>(`/projects/${id}/deploy`, {
        method: 'POST',
      }),
    updateImages: (id: number) =>
      request<{ success: boolean; changed: boolean; output: string }>(
        `/projects/${id}/update`,
        { method: 'POST' }
      ),
    readFiles: (id: number) =>
      request<{ composePath: string; composeContent: string; envPath: string | null; envContent: string }>(
        `/projects/${id}/files`
      ),
    saveFiles: (id: number, data: { composeContent: string; envContent?: string }) =>
      request<{ success: boolean }>(`/projects/${id}/files`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    validate: (id: number) =>
      request<{ valid: boolean; error?: string }>(`/projects/${id}/validate`, {
        method: 'POST',
      }),
    checkUpdates: (id: number, force = false) =>
      request<{ hasUpdates: boolean; services: string[] }>(`/projects/${id}/update-check${force ? '?force=1' : ''}`),
  },

  containers: {
    list: () => request<Container[]>('/containers'),
    logs: (id: string, tail?: number) =>
      request<{ logs: string }>(`/containers/${id}/logs${tail ? `?tail=${tail}` : ''}`),
    start: (id: string) =>
      request<{ success: boolean }>(`/containers/${id}/start`, { method: 'POST' }),
    stop: (id: string) =>
      request<{ success: boolean }>(`/containers/${id}/stop`, { method: 'POST' }),
    restart: (id: string) =>
      request<{ success: boolean }>(`/containers/${id}/restart`, { method: 'POST' }),
    remove: (id: string) =>
      request<{ success: boolean; output: string }>(`/containers/${id}`, { method: 'DELETE' }),
    updateImage: (id: string) =>
      request<{ success: boolean; output: string }>(`/containers/${id}/update-image`, { method: 'POST' }),
    checkUpdate: (id: string) =>
      request<{ success: boolean; hasUpdate: boolean }>(`/containers/${id}/check-update`, { method: 'POST' }),
  },

  home: {
    getTiles: () => request<{ overrides: HomeTileOverride[]; external: ExternalTile[]; proxyOverrides: ProxyTileOverride[] }>('/home/tiles'),
    updateTile: (projectId: number, serviceKey: string, data: { display_name?: string | null; icon?: string | null; icon_bg?: string | null; card_bg?: string | null; hidden?: boolean }) =>
      request<{ success: boolean }>(`/home/tiles/${projectId}/${encodeURIComponent(serviceKey)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateProxyTile: (proxyHostId: number, data: { display_name?: string | null; icon?: string | null; icon_bg?: string | null; card_bg?: string | null; hidden?: boolean }) =>
      request<{ success: boolean }>(`/home/proxy-tiles/${proxyHostId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    fetchFavicon: (url: string) =>
      request<{ dataUri: string }>(`/home/favicon?url=${encodeURIComponent(url)}`),
    fetchColors: (url: string) =>
      request<{ iconBg: string | null; cardBg: string | null }>(`/home/colors?url=${encodeURIComponent(url)}`),
    setOrder: (items: Array<{ type: 'tile'; projectId: number; serviceKey: string; sortOrder: number } | { type: 'external'; id: number; sortOrder: number } | { type: 'proxy-tile'; proxyHostId: number; sortOrder: number }>) =>
      request<{ success: boolean }>('/home/order', {
        method: 'POST',
        body: JSON.stringify({ items }),
      }),
    createExternal: (data: { name: string; url: string; icon?: string | null; icon_bg?: string | null; card_bg?: string | null }) =>
      request<{ success: boolean; id: number }>('/home/external', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateExternal: (id: number, data: { name: string; url: string; icon?: string | null; icon_bg?: string | null; card_bg?: string | null; hidden?: boolean }) =>
      request<{ success: boolean }>(`/home/external/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteExternal: (id: number) =>
      request<{ success: boolean }>(`/home/external/${id}`, { method: 'DELETE' }),
  },

  system: {
    getVersion: () => request<{
      currentVersion: string;
      latestVersion: string | null;
      updateAvailable: boolean;
      configured: boolean;
    }>('/system/version'),
    getSettings: () => request<SystemSettings>('/system/settings'),
    saveSettings: (data: Partial<SystemSettings>) =>
      request<{ success: boolean }>('/system/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    update: () =>
      request<{ success: boolean }>('/system/update', { method: 'POST' }),
    getContainers: () => request<Container[]>('/system/containers'),
    getAllContainers: (options?: { search?: string; project?: string; hasUpdate?: boolean; includeUpdates?: boolean; state?: string }) => {
      const params = new URLSearchParams();
      if (options?.search) params.set('search', options.search);
      if (options?.project) params.set('project', options.project);
      if (options?.hasUpdate) params.set('hasUpdate', 'true');
      if (options?.includeUpdates) params.set('includeUpdates', 'true');
      if (options?.state) params.set('state', options.state);
      const qs = params.toString() ? `?${params.toString()}` : '';
      return request<Container[]>(`/system/all-containers${qs}`);
    },
    getUpdates: () => request<{ hasUpdates: boolean; projects: Array<{ id: number; name: string; services: string[] }> }>('/system/updates'),
    getContainerUpdates: () => request<Record<string, { hasUpdate: boolean; checkedAt: number | null }>>('/system/container-updates'),
    checkAllUpdates: () => request<{ success: boolean; checked: number }>('/system/check-all-updates', { method: 'POST' }),
    getStats: () => request<{
      totalContainers: number;
      runningContainers: number;
      cpuPercent: number;
      memoryUsage: number;
      memoryLimit: number;
      memoryPercent: number;
      systemCpuPercent: number;
      systemMemoryUsage: number;
      systemMemoryTotal: number;
      systemMemoryPercent: number;
    }>('/system/stats'),
    getVolumes: () => request<VolumeInfo[]>('/system/volumes'),
    getNetworks: () => request<NetworkInfo[]>('/system/networks'),
    getImages: () => request<ImageInfo[]>('/system/images'),
    pruneImages: (danglingOnly = true) =>
      request<{ success: boolean; output: string }>('/system/images/prune', {
        method: 'POST',
        body: JSON.stringify({ danglingOnly }),
      }),
    removeImage: (id: string, force = false) =>
      request<{ success: boolean; output: string }>(`/system/images/${encodeURIComponent(id)}?force=${force}`, {
        method: 'DELETE',
      }),
    pruneNetworks: () =>
      request<{ success: boolean; output: string }>('/system/networks/prune', {
        method: 'POST',
      }),
    removeNetwork: (name: string) =>
      request<{ success: boolean; output: string }>(`/system/networks/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
  },

  proxy: {
    list: (projectId?: number) =>
      request<ProxyHost[]>(`/proxy/hosts${projectId != null ? `?project_id=${projectId}` : ''}`),
    listForHome: () =>
      request<ProxyHost[]>('/proxy/hosts?show_on_home=1'),
    get: (id: number) => request<ProxyHost>(`/proxy/hosts/${id}`),
    create: (data: ProxyHostInput) =>
      request<{ success: boolean; host: ProxyHost; caddy: CaddySyncResult }>('/proxy/hosts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: Partial<ProxyHostInput>) =>
      request<{ success: boolean; host: ProxyHost; caddy: CaddySyncResult }>(`/proxy/hosts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<{ success: boolean; caddy: CaddySyncResult }>(`/proxy/hosts/${id}`, { method: 'DELETE' }),
    getConfig: () =>
      request<{ running: Record<string, unknown> | null; generated: Record<string, unknown> }>('/proxy/config'),
    pushConfig: (config: Record<string, unknown>, saveAsOverride?: boolean) =>
      request<{ success: boolean; error?: string }>('/proxy/config', {
        method: 'PUT',
        body: JSON.stringify({ config, saveAsOverride }),
      }),
    getStatus: () => request<{ running: boolean; error?: string }>('/proxy/status'),
    reload: () => request<{ success: boolean; error?: string }>('/proxy/reload', { method: 'POST' }),
  },

  import: {
    parseRunCommand: (command: string) =>
      request<{ service: ParsedService; compose: string; envContent: string; warnings: ParseWarnings }>('/import/parse', {
        method: 'POST',
        body: JSON.stringify({ command }),
      }),
    getStandaloneContainers: () =>
      request<{ containers: StandaloneContainer[] }>('/import/standalone'),
    getDecisions: (containerIds: string[]) =>
      request<{ decisions: ContainerDecision[] }>('/import/decisions', {
        method: 'POST',
        body: JSON.stringify({ containerIds }),
      }),
    containersToCompose: (containerIds: string[], decisions: Record<string, boolean> = {}) =>
      request<{ containers: StandaloneContainer[]; compose: string; envContent: string; warnings: ParseWarnings; decisions: ContainerDecision[] }>('/import/containers', {
        method: 'POST',
        body: JSON.stringify({ containerIds, decisions }),
      }),
    saveCompose: (data: { compose: string; envContent: string; projectName: string }) =>
      request<{ success: boolean; project: Project; composePath: string; envPath: string | null }>('/import/save', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getExistingProjects: () =>
      request<{ projects: Array<{ name: string; path: string; composeExists: boolean }> }>('/import/existing-projects'),
    importExisting: (projectPaths: string[]) =>
      request<{ results: Array<{ name: string; path: string; success: boolean; error?: string }> }>('/import/existing', {
        method: 'POST',
        body: JSON.stringify({ projectPaths }),
      }),
  },
};

export interface ProxyHost {
  id: number;
  project_id: number | null;
  domain: string;
  upstream: string;
  basic_auth_user: string | null;
  local_only: boolean;
  enabled: boolean;
  tls_mode: 'internal' | 'acme';
  show_on_overview: boolean;
  show_on_home: boolean;
  created_at: string;
}

export interface ProxyHostInput {
  domain: string;
  upstream: string;
  project_id?: number | null;
  basic_auth_user?: string | null;
  basic_auth_password?: string | null;
  local_only?: boolean;
  enabled?: boolean;
  tls_mode?: 'internal' | 'acme';
  show_on_overview?: boolean;
  show_on_home?: boolean;
}

export interface CaddySyncResult {
  success: boolean;
  error?: string;
}

export interface ProjectUpdatePayload {
  name?: string;
  url?: string | null;
  icon?: string | null;
  autoUpdate?: boolean;
  autoUpdatePolicy?: AutoUpdatePolicy;
  watchEnabled?: boolean;
}

export interface SystemSettings {
  autoUpdate: boolean;
  domainSuffix: string;
  extraHostname: string;
  updateCheckInterval: number;
  certLifetime: number;
}

export interface HomeTileOverride {
  project_id: number;
  service_key: string;
  display_name: string | null;
  icon: string | null;
  icon_bg: string | null;
  card_bg: string | null;
  hidden: boolean;
  sort_order: number | null;
}

export interface ProxyTileOverride {
  proxy_host_id: number;
  display_name: string | null;
  icon: string | null;
  icon_bg: string | null;
  card_bg: string | null;
  hidden: boolean;
  sort_order: number | null;
}

export interface ExternalTile {
  id: number;
  name: string;
  url: string;
  icon: string | null;
  icon_bg: string | null;
  card_bg: string | null;
  hidden: boolean;
  sort_order: number | null;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  created: string;
  project?: string;
  type?: 'docker' | 'compose';
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  created: string;
  containers?: string[];
  used?: boolean;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
  used?: boolean;
}

export { ApiError };
