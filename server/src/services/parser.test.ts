import { describe, it, expect } from 'vitest';
import { parseDockerRun, serviceToCompose, generateEnvFromParsedService } from '../services/parser.js';

describe('parseDockerRun', () => {
  it('should return error for non-docker run command', () => {
    const result = parseDockerRun('docker-compose up');
    expect(result).toEqual({ error: 'Command must start with "docker run"' });
  });

  it('should parse simple docker run command', () => {
    const result = parseDockerRun('docker run nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.image).toBe('nginx:latest');
  });

  it('should extract container name', () => {
    const result = parseDockerRun('docker run --name mycontainer nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.name).toBe('mycontainer');
  });

  it('should parse port mapping', () => {
    const result = parseDockerRun('docker run -p 8080:80 nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.ports).toContainEqual({ host: '8080', container: '80' });
  });

  it('should parse volume mapping', () => {
    const result = parseDockerRun('docker run -v /data:/app/data nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ host: '/data', container: '/app/data' })
    ]));
  });

  it('should parse environment variables', () => {
    const result = parseDockerRun('docker run -e VAR1=value1 -e VAR2=value2 nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.environment.VAR1).toBe('value1');
    expect(result.service.environment.VAR2).toBe('value2');
  });

  it('should parse restart policy', () => {
    const result = parseDockerRun('docker run --restart unless-stopped nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.restart).toBe('unless-stopped');
  });

  it('should set privileged flag', () => {
    const result = parseDockerRun('docker run --privileged nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.privileged).toBe(true);
  });

  it('should handle line continuation backslashes', () => {
    const result = parseDockerRun('docker run \\\n--name mycontainer \\\n-v /data:/app \\\nnginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.name).toBe('mycontainer');
    expect(result.service.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ host: '/data', container: '/app' })
    ]));
  });

  it('should handle line continuation with multiple flags', () => {
    const result = parseDockerRun(`docker run \\
-e VAR1=value1 \\
-e VAR2=value2 \\
-p 8080:80 \\
nginx:latest`);
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.environment.VAR1).toBe('value1');
    expect(result.service.environment.VAR2).toBe('value2');
    expect(result.service.ports).toContainEqual({ host: '8080', container: '80' });
  });

  it('should handle mixed line continuations', () => {
    const result = parseDockerRun('docker run --name test \\\n-v /host:/cont nginx:latest');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.service.name).toBe('test');
    expect(result.service.image).toBe('nginx:latest');
  });
});

describe('serviceToCompose', () => {
  it('should generate minimal compose YAML', () => {
    const service = {
      name: 'web',
      image: 'nginx:latest',
      ports: [],
      volumes: [],
      environment: {},
      envFileVars: [],
      restart: 'unless-stopped',
      command: [],
      networks: [],
      depends_on: [],
      labels: {},
    };
    const yaml = serviceToCompose(service);
    expect(yaml).toContain('image: nginx:latest');
    expect(yaml).toContain('restart: unless-stopped');
  });

  it('should include ports in output', () => {
    const service = {
      name: 'web',
      image: 'nginx:latest',
      ports: [{ host: '8080', container: '80' }],
      volumes: [],
      environment: {},
      envFileVars: [],
      restart: '',
      command: [],
      networks: [],
      depends_on: [],
      labels: {},
    };
    const yaml = serviceToCompose(service);
    expect(yaml).toContain('8080:80');
  });

  it('should include volumes in output', () => {
    const service = {
      name: 'web',
      image: 'nginx:latest',
      ports: [],
      volumes: [{ host: '/data', container: '/app/data' }],
      environment: {},
      envFileVars: [],
      restart: '',
      command: [],
      networks: [],
      depends_on: [],
      labels: {},
    };
    const yaml = serviceToCompose(service);
    expect(yaml).toContain('/data:/app/data');
  });

  it('should include environment variables', () => {
    const service = {
      name: 'web',
      image: 'nginx:latest',
      ports: [],
      volumes: [],
      environment: { NODE_ENV: 'production', PORT: '8080' },
      envFileVars: [],
      restart: '',
      command: [],
      networks: [],
      depends_on: [],
      labels: {},
    };
    const yaml = serviceToCompose(service);
    expect(yaml).toContain('NODE_ENV: production');
    expect(yaml).toContain('PORT:');
    expect(yaml).toContain('8080');
  });

  it('should include networks', () => {
    const service = {
      name: 'web',
      image: 'nginx:latest',
      ports: [],
      volumes: [],
      environment: {},
      envFileVars: [],
      restart: '',
      command: [],
      networks: ['frontend', 'backend'],
      depends_on: [],
      labels: {},
    };
    const yaml = serviceToCompose(service);
    expect(yaml).toContain('frontend');
    expect(yaml).toContain('backend');
  });
});

describe('generateEnvFromParsedService', () => {
  it('should generate environment variables', () => {
    const service = {
      name: 'web',
      image: 'nginx:latest',
      ports: [],
      volumes: [],
      environment: { VAR1: 'value1', VAR2: 'value2' },
      envFileVars: [],
      restart: '',
      command: [],
      networks: [],
      depends_on: [],
      labels: {},
    };
    const env = generateEnvFromParsedService(service);
    expect(env).toContain('VAR1=value1');
    expect(env).toContain('VAR2=value2');
  });

  it('should include envFileVars keys without values', () => {
    const service = {
      name: 'web',
      image: 'nginx:latest',
      ports: [],
      volumes: [],
      environment: {},
      envFileVars: ['VAR1', 'VAR2'],
      restart: '',
      command: [],
      networks: [],
      depends_on: [],
      labels: {},
    };
    const env = generateEnvFromParsedService(service);
    expect(env).toContain('VAR1');
    expect(env).toContain('VAR2');
  });
});