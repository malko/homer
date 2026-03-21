import { execSync } from 'child_process';

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

const SYSTEM_ENV_VARS = new Set([
  'PATH', 'HOSTNAME', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'PWD', 'OLDPWD', '_', 'SHLVL', 'LS_COLORS', 'EDITOR', 'VISUAL',
  'MAIL', 'LOGNAME', 'USERNAME', 'SUDO_COMMAND', 'SUDO_USER', 'SUDO_UID',
  'SUDO_GID', 'SUDO_COMMAND', 'XDG_SESSION_TYPE', 'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS', 'COLORTERM', 'npm_config_*',
  'NODE_VERSION', 'YARN_VERSION',
]);

function isSystemEnvVar(key: string): boolean {
  if (SYSTEM_ENV_VARS.has(key)) return true;
  if (key.startsWith('npm_config_')) return true;
  if (key.startsWith('npm_package_')) return true;
  if (key.startsWith('yarn_package_')) return true;
  if (key.startsWith('YARN_')) return true;
  if (key.startsWith('NODE_')) return true;
  if (key.startsWith('JAVA_') && (key.includes('VERSION') || key.includes('HOME'))) return true;
  if (key.startsWith('GRADLE_') && (key.includes('VERSION') || key.includes('HOME'))) return true;
  if (key.startsWith('DOTNET_')) return true;
  if (key.startsWith('PYTHON')) return true;
  if (key.startsWith('CONDA_')) return true;
  return false;
}

function quoteIfNeeded(str: string): string {
  if (!str) return "''";
  if (/[:#$*!?()[\]{}|\\;<>&\s]/.test(str)) {
    return `"${str.replace(/"/g, '\\"').replace(/\\/g, '\\\\')}"`;
  }
  return str;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && inQuote) {
      escaped = true;
      continue;
    }

    if (char === inQuote) {
      inQuote = null;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = char;
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseDockerRun(command: string): { service: ParsedService; warnings: ParseWarnings } | { error: string } {
  const trimmed = command.trim();

  if (!trimmed.startsWith('docker run')) {
    return { error: 'Command must start with "docker run"' };
  }

  const tokens = tokenize(trimmed.slice(10).trim());

  let image = '';
  let name = '';
  const ports: ParsedService['ports'] = [];
  const volumes: ParsedService['volumes'] = [];
  const environment: Record<string, string> = {};
  const envFileVars: string[] = [];
  let restart = '';
  const commandArgs: string[] = [];
  const networks: string[] = [];
  const depends_on: string[] = [];
  const labels: Record<string, string> = {};
  const extraHosts: string[] = [];
  let gpus: string | undefined;
  let privileged = false;
  const capAdd: string[] = [];
  const capDrop: string[] = [];
  const warnings: ParseWarnings = { unsupported: [], skipped: [] };

  const skipNext = (arr: string[], idx: number): number => {
    let i = idx;
    while (i + 1 < arr.length && !arr[i + 1]?.startsWith('-')) {
      i++;
    }
    return i;
  };

  const getValue = (arg: string): { value: string; consumed: number } => {
    if (arg.includes('=')) {
      return { value: arg.split('=').slice(1).join('='), consumed: 0 };
    }
    return { value: '', consumed: 1 };
  };

  let i = 0;
  while (i < tokens.length) {
    const arg = tokens[i];

    if (arg === '-d' || arg === '--detach') {
      i++;
      continue;
    }

    if (arg === '--name' || arg === '-name' || arg.startsWith('--name=')) {
      if (arg.startsWith('--name=')) {
        name = arg.slice('--name='.length);
      } else {
        name = tokens[++i] || '';
      }
      i++;
      continue;
    }

    if (arg === '-p' || arg === '--publish') {
      const portMapping = tokens[++i] || '';
      const parts = portMapping.split(':');
      if (parts.length >= 2) {
        ports.push({ host: parts[0], container: parts[parts.length - 1] });
      } else if (parts.length === 1 && parts[0]) {
        ports.push({ host: parts[0], container: parts[0] });
      }
      i++;
      continue;
    }

    if (arg === '-v' || arg === '--volume') {
      const volumeSpec = tokens[++i] || '';
      const parts = volumeSpec.split(':');
      if (parts.length >= 2) {
        const isReadonly = volumeSpec.endsWith(':ro');
        volumes.push({
          host: parts[0],
          container: parts[1],
          readonly: isReadonly,
        });
      } else if (parts.length === 1) {
        volumes.push({ host: parts[0], container: parts[0] });
      }
      i++;
      continue;
    }

    if (arg === '-e' || arg === '--env') {
      const envVar = tokens[++i] || '';
      const eqIndex = envVar.indexOf('=');
      if (eqIndex > 0) {
        const key = envVar.slice(0, eqIndex);
        const value = envVar.slice(eqIndex + 1);
        if (isSystemEnvVar(key)) {
          envFileVars.push(envVar);
        } else {
          environment[key] = value;
        }
      } else {
        envFileVars.push(envVar);
      }
      i++;
      continue;
    }

    if (arg === '--env-file' || arg.startsWith('--env-file=')) {
      warnings.skipped.push('--env-file flag (content will be included in .env)');
      if (!arg.startsWith('--env-file=')) {
        i = skipNext(tokens, i);
      }
      i++;
      continue;
    }

    if (arg === '--restart' || arg.startsWith('--restart=')) {
      restart = arg.startsWith('--restart=') 
        ? arg.slice('--restart='.length) 
        : (tokens[++i] || 'no');
      i++;
      continue;
    }

    if (arg === '--network' || arg === '--net' || arg.startsWith('--network=') || arg.startsWith('--net=')) {
      const network = arg.startsWith('--network=') 
        ? arg.slice('--network='.length)
        : arg.startsWith('--net=')
          ? arg.slice('--net='.length)
          : tokens[++i] || '';
      if (network && network !== 'bridge') {
        networks.push(network);
      }
      i++;
      continue;
    }

    if (arg === '--label' || arg === '-l' || arg.startsWith('--label=') || arg.startsWith('-l ')) {
      let label = '';
      if (arg.startsWith('--label=')) {
        label = arg.slice('--label='.length);
      } else if (arg.startsWith('-l ')) {
        label = arg.slice(3);
      } else {
        label = tokens[++i] || '';
      }
      const eqIndex = label.indexOf('=');
      if (eqIndex > 0) {
        labels[label.slice(0, eqIndex)] = label.slice(eqIndex + 1);
      }
      i++;
      continue;
    }

    if (arg === '--gpus' || arg.startsWith('--gpus=')) {
      gpus = arg.startsWith('--gpus=')
        ? arg.slice('--gpus='.length)
        : tokens[++i] || 'all';
      i++;
      continue;
    }

    if (arg === '--add-host' || arg.startsWith('--add-host=')) {
      const host = arg.startsWith('--add-host=')
        ? arg.slice('--add-host='.length)
        : tokens[++i] || '';
      if (host) {
        extraHosts.push(host);
      }
      i++;
      continue;
    }

    if (arg === '--privileged') {
      privileged = true;
      i++;
      continue;
    }

    if (arg === '--cap-add' || arg.startsWith('--cap-add=')) {
      const cap = arg.startsWith('--cap-add=')
        ? arg.slice('--cap-add='.length)
        : tokens[++i] || '';
      if (cap) capAdd.push(cap);
      i++;
      continue;
    }

    if (arg === '--cap-drop' || arg.startsWith('--cap-drop=')) {
      const cap = arg.startsWith('--cap-drop=')
        ? arg.slice('--cap-drop='.length)
        : tokens[++i] || '';
      if (cap) capDrop.push(cap);
      i++;
      continue;
    }

    if (arg === '--device' || arg.startsWith('--device=')) {
      warnings.skipped.push('--device flag requires manual configuration');
      if (!arg.startsWith('--device=')) {
        i = skipNext(tokens, i);
      }
      i++;
      continue;
    }

    if (arg === '--sysctl' || arg.startsWith('--sysctl=')) {
      warnings.skipped.push('--sysctl flag requires manual configuration');
      if (!arg.startsWith('--sysctl=')) {
        i = skipNext(tokens, i);
      }
      i++;
      continue;
    }

    if (arg === '--tmpfs' || arg.startsWith('--tmpfs=')) {
      warnings.skipped.push('--tmpfs flag requires manual configuration');
      if (!arg.startsWith('--tmpfs=')) {
        i = skipNext(tokens, i);
      }
      i++;
      continue;
    }

    if (arg === '--security-opt' || arg.startsWith('--security-opt=')) {
      warnings.skipped.push('--security-opt flag requires manual configuration');
      if (!arg.startsWith('--security-opt=')) {
        i = skipNext(tokens, i);
      }
      i++;
      continue;
    }

    if (arg === '--ulimit' || arg.startsWith('--ulimit=')) {
      warnings.skipped.push('--ulimit flag requires manual configuration');
      if (!arg.startsWith('--ulimit=')) {
        i = skipNext(tokens, i);
      }
      i++;
      continue;
    }

    if (arg.startsWith('-')) {
      warnings.unsupported.push(`${arg} flag requires manual configuration`);
      i = skipNext(tokens, i);
      i++;
      continue;
    }

    if (!image) {
      image = arg;
      i++;
      continue;
    }

    commandArgs.push(arg);
    i++;
  }

  if (!image) {
    return { error: 'No image specified in docker run command' };
  }

  const serviceName = name ||
    image.split('/').pop()?.replace(/:.*/, '')?.replace(/\//g, '-') ||
    'service';

  if (networks.includes('host') && networks.length > 1) {
    warnings.skipped.push('--network=host cannot be combined with other networks in compose');
  }

  return {
    service: {
      name: serviceName,
      image,
      ports,
      volumes,
      environment,
      envFileVars,
      restart: restart || 'unless-stopped',
      command: commandArgs,
      networks,
      depends_on,
      labels,
      gpus,
      privileged,
      capAdd: capAdd.length > 0 ? capAdd : undefined,
      capDrop: capDrop.length > 0 ? capDrop : undefined,
      extra_hosts: extraHosts.length > 0 ? extraHosts : undefined,
    },
    warnings,
  };
}

function generateEnvContent(envVars: string[]): string {
  if (envVars.length === 0) return '';
  return envVars.join('\n') + '\n';
}

export function serviceToCompose(service: ParsedService): string {
  const lines: string[] = ['services:'];
  const indent = '  ';
  const serviceName = sanitizeName(service.name);

  lines.push(`${indent}${serviceName}:`);
  lines.push(`${indent}  image: ${service.image}`);

  if (service.ports.length > 0) {
    lines.push(`${indent}  ports:`);
    for (const port of service.ports) {
      lines.push(`${indent}    - "${port.host}:${port.container}"`);
    }
  }

  if (service.volumes.length > 0) {
    lines.push(`${indent}  volumes:`);
    for (const vol of service.volumes) {
      const volStr = vol.readonly ? `${vol.host}:${vol.container}:ro` : `${vol.host}:${vol.container}`;
      lines.push(`${indent}    - ${quoteIfNeeded(volStr)}`);
    }
  }

  if (service.envFileVars.length > 0) {
    lines.push(`${indent}  env_file:`);
    lines.push(`${indent}    - .env`);
  }

  if (Object.keys(service.environment).length > 0) {
    lines.push(`${indent}  environment:`);
    for (const [key, value] of Object.entries(service.environment)) {
      if (value) {
        lines.push(`${indent}    ${key}: ${quoteIfNeeded(value)}`);
      } else {
        lines.push(`${indent}    ${key}:`);
      }
    }
  }

  if (service.restart && service.restart !== 'no') {
    lines.push(`${indent}  restart: ${service.restart}`);
  }

  if (service.command.length > 0) {
    const cmdStr = service.command.map(c => quoteIfNeeded(c)).join(' ');
    lines.push(`${indent}  command: ${cmdStr}`);
  }

  if (service.gpus) {
    lines.push(`${indent}  deploy:`);
    lines.push(`${indent}    resources:`);
    lines.push(`${indent}      reservations:`);
    lines.push(`${indent}        devices:`);
    if (service.gpus === 'all') {
      lines.push(`${indent}          - driver: nvidia`);
      lines.push(`${indent}            count: all`);
      lines.push(`${indent}            capabilities: [gpu]`);
    } else if (/^\d+$/.test(service.gpus)) {
      lines.push(`${indent}          - driver: nvidia`);
      lines.push(`${indent}            count: ${service.gpus}`);
      lines.push(`${indent}            capabilities: [gpu]`);
    } else if (service.gpus.startsWith('device=')) {
      const deviceId = service.gpus.replace('device=', '');
      lines.push(`${indent}          - driver: nvidia`);
      lines.push(`${indent}            device_ids: ["${deviceId}"]`);
      lines.push(`${indent}            capabilities: [gpu]`);
    } else {
      lines.push(`${indent}          - driver: nvidia`);
      lines.push(`${indent}            count: all`);
      lines.push(`${indent}            capabilities: [gpu]`);
    }
  }

  if (service.privileged) {
    lines.push(`${indent}  privileged: true`);
  }

  if (service.capAdd && service.capAdd.length > 0) {
    lines.push(`${indent}  cap_add:`);
    for (const cap of service.capAdd) {
      lines.push(`${indent}    - ${cap}`);
    }
  }

  if (service.capDrop && service.capDrop.length > 0) {
    lines.push(`${indent}  cap_drop:`);
    for (const cap of service.capDrop) {
      lines.push(`${indent}    - ${cap}`);
    }
  }

  if (service.extra_hosts && service.extra_hosts.length > 0) {
    lines.push(`${indent}  extra_hosts:`);
    for (const host of service.extra_hosts) {
      lines.push(`${indent}    - "${host}"`);
    }
  }

  if (service.networks.includes('host')) {
    lines.push(`${indent}  network_mode: host`);
  } else if (service.networks.length > 0) {
    lines.push(`${indent}  networks:`);
    for (const network of service.networks) {
      lines.push(`${indent}    - ${network}`);
    }
  }

  if (Object.keys(service.labels).length > 0) {
    lines.push(`${indent}  labels:`);
    for (const [key, value] of Object.entries(service.labels)) {
      lines.push(`${indent}    ${key}: ${quoteIfNeeded(value)}`);
    }
  }

  const networksForExternal = service.networks.filter(n => n !== 'host');
  if (networksForExternal.length > 0) {
    lines.push('');
    lines.push('networks:');
    const networkSet = new Set(networksForExternal);
    for (const network of networkSet) {
      lines.push(`  ${sanitizeName(network)}:`);
      lines.push(`    name: ${network}`);
    }
  }

  return lines.join('\n');
}

export function generateEnvFromParsedService(service: ParsedService): string {
  const allEnvVars = [...service.envFileVars];
  for (const [key, value] of Object.entries(service.environment)) {
    allEnvVars.push(`${key}=${value}`);
  }
  return generateEnvContent(allEnvVars);
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

function inspectContainer(containerId: string, format: string): string {
  try {
    return execSync(`docker inspect --format "${format}" ${containerId}`, {
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function inspectContainerBool(containerId: string, format: string): boolean {
  try {
    const result = execSync(`docker inspect --format "${format}" ${containerId}`, {
      encoding: 'utf-8',
    }).trim();
    return result === 'true';
  } catch {
    return false;
  }
}

export async function getStandaloneContainers(): Promise<StandaloneContainer[]> {
  try {
    const output = execSync(
      'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Command}}|{{.CreatedAt}}|{{.Status}}|{{.Ports}}"',
      { encoding: 'utf-8' }
    );

    const stdout = output.trim();
    if (!stdout) return [];

    const containers: StandaloneContainer[] = [];

    for (const line of stdout.split('\n')) {
      const [id, name, image, command, created, status, ports] = line.split('|');

      const composeLabel = inspectContainer(id, '{{index .Config.Labels "com.docker.compose.project"}}');
      if (composeLabel) continue;

      let hasGpu = false;
      try {
        const deviceRequests = inspectContainer(id, '{{json .HostConfig.DeviceRequests}}');
        if (deviceRequests && deviceRequests !== '[]' && deviceRequests !== '<no value>') {
          const parsed = JSON.parse(deviceRequests);
          if (Array.isArray(parsed) && parsed.some((d: { Capabilities?: string[][] }) => 
            d.Capabilities?.some((c: string[]) => c.includes('gpu'))
          )) {
            hasGpu = true;
          }
        }
      } catch {}

      containers.push({
        id,
        name,
        image,
        command,
        created,
        status,
        ports,
        hasGpu,
      });
    }

    return containers;
  } catch {
    return [];
  }
}

function containerToService(
  container: StandaloneContainer,
  decisions: Record<string, boolean>
): ParsedService {
  const ports: Array<{ host: string; container: string }> = [];
  if (container.ports) {
    const portMappings = container.ports.split(',').map(p => p.trim()).filter(Boolean);
    for (const mapping of portMappings) {
      const match = mapping.match(/^(?:0\.0\.0\.0:)?(\d+)(?::(\d+))?/);
      if (match) {
        ports.push({
          host: match[1],
          container: match[2] || match[1],
        });
      }
    }
  }

  const volumes: Array<{ host: string; container: string; readonly?: boolean }> = [];
  try {
    const mountStr = inspectContainer(container.id, '{{range .Mounts}}{{.Source}}:{{.Destination}}:{{if .RW}}rw{{else}}ro{{end}},{{end}}');
    if (mountStr) {
      mountStr.split(',').filter(Boolean).forEach(mount => {
        const [host, containerPath, mode] = mount.split(':');
        if (host && containerPath) {
          volumes.push({
            host,
            container: containerPath,
            readonly: mode === 'ro',
          });
        }
      });
    }
  } catch {}

  const environment: Record<string, string> = {};
  const envFileVars: string[] = [];
  try {
    const envStr = inspectContainer(container.id, '{{range .Config.Env}}{{.}}|{{end}}');
    envStr.split('|').filter(Boolean).forEach(env => {
      const eqIndex = env.indexOf('=');
      if (eqIndex > 0) {
        const key = env.slice(0, eqIndex);
        const value = env.slice(eqIndex + 1);
        if (isSystemEnvVar(key)) {
          envFileVars.push(env);
        } else {
          environment[key] = value;
        }
      }
    });
  } catch {}

  let restart = 'unless-stopped';
  try {
    const policy = inspectContainer(container.id, '{{.HostConfig.RestartPolicy.Name}}');
    if (policy && policy !== 'no') {
      restart = policy;
    }
  } catch {}

  const networks: string[] = [];
  try {
    const netStr = inspectContainer(container.id, '{{range $k, $v := .NetworkSettings.Networks}}{{$k}},{{end}}');
    netStr.split(',').filter(Boolean).forEach(net => {
      if (net && net !== 'bridge') {
        networks.push(net.trim());
      }
    });
  } catch {}

  const extraHosts: string[] = [];
  try {
    const hostsStr = inspectContainer(container.id, '{{json .HostConfig.ExtraHosts}}');
    if (hostsStr && hostsStr !== 'null' && hostsStr !== '<no value>') {
      try {
        const hosts = JSON.parse(hostsStr);
        if (Array.isArray(hosts)) {
          extraHosts.push(...hosts.map((h: { Host: string }) => h.Host));
        }
      } catch {}
    }
  } catch {}

  const command: string[] = [];
  try {
    const cmdOutput = inspectContainer(container.id, '{{json .Config.Cmd}}');
    if (cmdOutput && cmdOutput !== 'null' && cmdOutput !== '[]') {
      const cmdArr = JSON.parse(cmdOutput);
      if (Array.isArray(cmdArr)) {
        command.push(...cmdArr.filter((c: unknown) => typeof c === 'string'));
      }
    }
  } catch {}

  const enableGpu = decisions[`${container.id}:gpu`];
  const enablePrivileged = decisions[`${container.id}:privileged`];
  const enableCapabilities = decisions[`${container.id}:capability`];

  let gpus: string | undefined;
  if (container.hasGpu && enableGpu) {
    gpus = 'all';
  }

  let privileged = false;
  if (enablePrivileged) {
    privileged = inspectContainerBool(container.id, '{{.HostConfig.Privileged}}');
  }

  const capAdd: string[] = [];
  const capDrop: string[] = [];
  if (enableCapabilities) {
    try {
      const capsStr = inspectContainer(container.id, '{{json .HostConfig.CapAdd}}');
      if (capsStr && capsStr !== 'null' && capsStr !== '<no value>') {
        try {
          const caps = JSON.parse(capsStr);
          if (Array.isArray(caps)) {
            capAdd.push(...caps);
          }
        } catch {}
      }
      const capsDropStr = inspectContainer(container.id, '{{json .HostConfig.CapDrop}}');
      if (capsDropStr && capsDropStr !== 'null' && capsDropStr !== '<no value>') {
        try {
          const caps = JSON.parse(capsDropStr);
          if (Array.isArray(caps)) {
            capDrop.push(...caps);
          }
        } catch {}
      }
    } catch {}
  }

  return {
    name: container.name,
    image: container.image,
    ports,
    volumes,
    environment,
    envFileVars,
    restart,
    command,
    networks,
    depends_on: [],
    labels: {},
    gpus,
    privileged,
    capAdd: capAdd.length > 0 ? capAdd : undefined,
    capDrop: capDrop.length > 0 ? capDrop : undefined,
    extra_hosts: extraHosts.length > 0 ? extraHosts : undefined,
  };
}

export function getContainerDecisions(container: StandaloneContainer): ContainerDecision[] {
  const decisions: ContainerDecision[] = [];

  if (container.hasGpu) {
    decisions.push({
      containerId: container.id,
      containerName: container.name,
      type: 'gpu',
      current: 'GPU detected',
      message: `Container "${container.name}" has GPU access enabled. Enable GPU support in the compose file?`,
      enabled: true,
    });
  }

  try {
    const privileged = inspectContainerBool(container.id, '{{.HostConfig.Privileged}}');
    if (privileged) {
      decisions.push({
        containerId: container.id,
        containerName: container.name,
        type: 'privileged',
        current: 'Privileged mode',
        message: `Container "${container.name}" runs in privileged mode. This gives the container full access to the host. Include this in the compose file?`,
        enabled: true,
      });
    }
  } catch {}

  try {
    const capsStr = inspectContainer(container.id, '{{json .HostConfig.CapAdd}}');
    if (capsStr && capsStr !== 'null' && capsStr !== '<no value>') {
      try {
        const caps = JSON.parse(capsStr);
        if (Array.isArray(caps) && caps.length > 0) {
          decisions.push({
            containerId: container.id,
            containerName: container.name,
            type: 'capability',
            current: `cap_add: ${caps.join(', ')}`,
            message: `Container "${container.name}" has custom capabilities: ${caps.join(', ')}. Include these in the compose file?`,
            enabled: true,
          });
        }
      } catch {}
    }
  } catch {}

  return decisions;
}

function getUniqueServiceName(baseName: string, existing: Record<string, boolean>): string {
  const sanitized = sanitizeName(baseName);
  if (!existing[sanitized]) {
    existing[sanitized] = true;
    return sanitized;
  }

  let counter = 1;
  while (existing[`${sanitized}-${counter}`]) {
    counter++;
  }
  const unique = `${sanitized}-${counter}`;
  existing[unique] = true;
  return unique;
}

export interface MigrationResult {
  compose: string;
  envContent: string;
  warnings: ParseWarnings;
  decisions: ContainerDecision[];
}

export function containersToCompose(
  containers: StandaloneContainer[],
  decisions: Record<string, boolean> = {}
): MigrationResult {
  if (containers.length === 0) {
    return { compose: '', envContent: '', warnings: { unsupported: [], skipped: [] }, decisions: [] };
  }

  const warnings: ParseWarnings = { unsupported: [], skipped: [] };
  const allDecisions: ContainerDecision[] = [];
  const envVars: string[] = [];
  const serviceNames: Record<string, boolean> = {};
  const lines: string[] = ['services:'];

  for (const container of containers) {
    const service = containerToService(container, decisions);

    const containerDecisions = getContainerDecisions(container);
    for (const decision of containerDecisions) {
      if (!allDecisions.some(d => d.containerId === decision.containerId && d.type === decision.type)) {
        allDecisions.push(decision);
      }
    }

    for (const [key, value] of Object.entries(service.environment)) {
      envVars.push(`${key}=${value}`);
    }
    envVars.push(...service.envFileVars);

    const serviceName = getUniqueServiceName(service.name, serviceNames);

    lines.push(`  ${serviceName}:`);
    lines.push(`    image: ${service.image}`);

    if (service.ports.length > 0) {
      lines.push(`    ports:`);
      for (const port of service.ports) {
        lines.push(`      - "${port.host}:${port.container}"`);
      }
    }

    if (service.volumes.length > 0) {
      lines.push(`    volumes:`);
      for (const vol of service.volumes) {
        const volStr = vol.readonly ? `${vol.host}:${vol.container}:ro` : `${vol.host}:${vol.container}`;
        lines.push(`      - ${quoteIfNeeded(volStr)}`);
      }
    }

    if (service.envFileVars.length > 0 || Object.keys(service.environment).length > 0) {
      lines.push(`    env_file:`);
      lines.push(`      - .env`);
    }

    if (Object.keys(service.environment).length > 0) {
      lines.push(`    environment:`);
      for (const [key, value] of Object.entries(service.environment)) {
        if (value) {
          lines.push(`      ${key}: ${quoteIfNeeded(value)}`);
        } else {
          lines.push(`      ${key}:`);
        }
      }
    }

    if (service.restart && service.restart !== 'no') {
      lines.push(`    restart: ${service.restart}`);
    }

    if (service.command.length > 0) {
      const cmdStr = service.command.map(c => quoteIfNeeded(c)).join(' ');
      lines.push(`    command: ${cmdStr}`);
    }

    if (service.gpus) {
      lines.push(`    deploy:`);
      lines.push(`      resources:`);
      lines.push(`        reservations:`);
      lines.push(`          devices:`);
      lines.push(`            - driver: nvidia`);
      lines.push(`              count: all`);
      lines.push(`              capabilities: [gpu]`);
    }

    if (service.privileged) {
      lines.push(`    privileged: true`);
    }

    if (service.capAdd && service.capAdd.length > 0) {
      lines.push(`    cap_add:`);
      for (const cap of service.capAdd) {
        lines.push(`      - ${cap}`);
      }
    }

    if (service.capDrop && service.capDrop.length > 0) {
      lines.push(`    cap_drop:`);
      for (const cap of service.capDrop) {
        lines.push(`      - ${cap}`);
      }
    }

    if (service.networks.length > 0) {
      lines.push(`    networks:`);
      for (const network of service.networks) {
        lines.push(`      - ${network}`);
      }
    }
  }

  const allNetworks = new Set<string>();
  for (const container of containers) {
    try {
      const netStr = inspectContainer(container.id, '{{range $k, $v := .NetworkSettings.Networks}}{{$k}},{{end}}');
      netStr.split(',').filter(Boolean).forEach(net => {
        if (net && net !== 'bridge') {
          allNetworks.add(net.trim());
        }
      });
    } catch {}
  }

  if (allNetworks.size > 0) {
    lines.push('');
    lines.push('networks:');
    for (const network of allNetworks) {
      lines.push(`  ${sanitizeName(network)}:`);
      lines.push(`    name: ${network}`);
    }
  }

  const uniqueEnvVars = [...new Set(envVars)];
  const envContent = generateEnvContent(uniqueEnvVars);

  return {
    compose: lines.join('\n'),
    envContent,
    warnings,
    decisions: allDecisions,
  };
}
