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
  created: string;
  ports?: string[];
}

export interface Project {
  id: number;
  name: string;
  path: string;
  env_path: string | null;
  auto_update: boolean;
  watch_enabled: boolean;
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
    create: (data: { name: string; autoUpdate?: boolean; watchEnabled?: boolean }) =>
      request<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: Partial<Project>) =>
      request<Project>(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
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
  },
};

export { ApiError };
