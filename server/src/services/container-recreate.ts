/**
 * Helpers for recreating a container on the same configuration after pulling a
 * new image. Pure functions over `docker inspect` output so they can be unit
 * tested without Docker.
 */

export interface DockerInspect {
  Name?: string;
  Config?: {
    Image?: string;
    Env?: string[] | null;
    Cmd?: string[] | null;
    Labels?: Record<string, string> | null;
  };
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }>> | null;
    Binds?: string[] | null;
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number } | null;
  };
  NetworkSettings?: {
    Networks?: Record<string, unknown> | null;
  };
}

export interface ComposeInfo {
  project: string;
  service: string;
  /** Compose files declared on the container, in order. */
  configFiles: string[];
  workingDir: string | null;
}

/**
 * Extract compose provenance from a container's labels. Returns null for
 * containers that were not created by `docker compose`.
 */
export function parseComposeInfo(labels: Record<string, string> | null | undefined): ComposeInfo | null {
  if (!labels) return null;
  const project = labels['com.docker.compose.project'];
  const service = labels['com.docker.compose.service'];
  const configFilesRaw = labels['com.docker.compose.project.config_files'];
  if (!project || !service || !configFilesRaw) return null;
  const configFiles = configFilesRaw.split(',').map(f => f.trim()).filter(Boolean);
  if (configFiles.length === 0) return null;
  return {
    project,
    service,
    configFiles,
    workingDir: labels['com.docker.compose.project.working_dir'] || null,
  };
}

/**
 * Build the `docker` argv (for execFile — no shell) that recreates a standalone
 * container preserving its name, restart policy, environment, published ports,
 * bind mounts, networks and command.
 *
 * Docker `run` attaches a single network; any additional networks are returned
 * separately so the caller can `docker network connect` them afterwards.
 * Entrypoint is intentionally left to the (updated) image default.
 */
export function buildDockerRunArgs(inspect: DockerInspect): { args: string[]; extraNetworks: string[] } {
  const image = inspect.Config?.Image;
  if (!image) throw new Error('Container inspect data has no image');

  const args: string[] = ['run', '-d'];

  const name = (inspect.Name ?? '').replace(/^\//, '');
  if (name) args.push('--name', name);

  const restart = inspect.HostConfig?.RestartPolicy?.Name;
  if (restart && restart !== 'no') {
    if (restart === 'on-failure' && inspect.HostConfig?.RestartPolicy?.MaximumRetryCount) {
      args.push('--restart', `on-failure:${inspect.HostConfig.RestartPolicy.MaximumRetryCount}`);
    } else {
      args.push('--restart', restart);
    }
  }

  for (const [key, value] of Object.entries(inspect.Config?.Labels ?? {})) {
    args.push('--label', `${key}=${value}`);
  }

  for (const env of inspect.Config?.Env ?? []) {
    args.push('-e', env);
  }

  for (const [containerPort, bindings] of Object.entries(inspect.HostConfig?.PortBindings ?? {})) {
    for (const b of bindings ?? []) {
      if (!b.HostPort) continue;
      const hostIp = b.HostIp && b.HostIp !== '0.0.0.0' ? `${b.HostIp}:` : '';
      args.push('-p', `${hostIp}${b.HostPort}:${containerPort}`);
    }
  }

  for (const bind of inspect.HostConfig?.Binds ?? []) {
    args.push('-v', bind);
  }

  const networks = Object.keys(inspect.NetworkSettings?.Networks ?? {});
  const extraNetworks: string[] = [];
  if (networks.length > 0) {
    args.push('--network', networks[0]);
    extraNetworks.push(...networks.slice(1));
  }

  args.push(image);

  for (const arg of inspect.Config?.Cmd ?? []) {
    args.push(arg);
  }

  return { args, extraNetworks };
}
