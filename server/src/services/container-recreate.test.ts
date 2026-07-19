import { describe, it, expect } from 'vitest';
import { parseComposeInfo, buildDockerRunArgs, type DockerInspect } from './container-recreate.js';

describe('parseComposeInfo', () => {
  it('extracts compose provenance from labels', () => {
    expect(parseComposeInfo({
      'com.docker.compose.project': 'myapp',
      'com.docker.compose.service': 'web',
      'com.docker.compose.project.config_files': '/srv/myapp/docker-compose.yml',
      'com.docker.compose.project.working_dir': '/srv/myapp',
    })).toEqual({
      project: 'myapp',
      service: 'web',
      configFiles: ['/srv/myapp/docker-compose.yml'],
      workingDir: '/srv/myapp',
    });
  });

  it('splits multiple compose files', () => {
    const info = parseComposeInfo({
      'com.docker.compose.project': 'myapp',
      'com.docker.compose.service': 'web',
      'com.docker.compose.project.config_files': '/a/compose.yml,/a/override.yml',
    });
    expect(info?.configFiles).toEqual(['/a/compose.yml', '/a/override.yml']);
    expect(info?.workingDir).toBeNull();
  });

  it('returns null for standalone containers', () => {
    expect(parseComposeInfo(null)).toBeNull();
    expect(parseComposeInfo({})).toBeNull();
    expect(parseComposeInfo({ 'com.docker.compose.project': 'x' })).toBeNull();
  });
});

describe('buildDockerRunArgs', () => {
  const inspect: DockerInspect = {
    Name: '/pihole',
    Config: {
      Image: 'pihole/pihole:latest',
      Env: ['TZ=Europe/Paris', 'WEBPASSWORD=secret'],
      Cmd: ['--no-daemon'],
      Labels: { maintainer: 'me' },
    },
    HostConfig: {
      PortBindings: {
        '53/tcp': [{ HostIp: '0.0.0.0', HostPort: '53' }],
        '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }],
      },
      Binds: ['/srv/pihole/etc:/etc/pihole:rw'],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    NetworkSettings: { Networks: { homer_default: {}, monitoring: {} } },
  };

  it('preserves name, restart, env, ports, binds, labels, network and command', () => {
    const { args, extraNetworks } = buildDockerRunArgs(inspect);

    expect(args.slice(0, 2)).toEqual(['run', '-d']);
    expect(args).toContain('--name');
    expect(args[args.indexOf('--name') + 1]).toBe('pihole');
    expect(args).toEqual(expect.arrayContaining(['--restart', 'unless-stopped']));
    expect(args).toEqual(expect.arrayContaining(['-e', 'TZ=Europe/Paris', '-e', 'WEBPASSWORD=secret']));
    expect(args).toEqual(expect.arrayContaining(['-p', '53:53/tcp']));
    expect(args).toEqual(expect.arrayContaining(['-p', '127.0.0.1:8080:80/tcp']));
    expect(args).toEqual(expect.arrayContaining(['-v', '/srv/pihole/etc:/etc/pihole:rw']));
    expect(args).toEqual(expect.arrayContaining(['--label', 'maintainer=me']));
    expect(args).toEqual(expect.arrayContaining(['--network', 'homer_default']));

    // Image comes before the command, which is appended last.
    const imageIdx = args.indexOf('pihole/pihole:latest');
    expect(imageIdx).toBeGreaterThan(0);
    expect(args[imageIdx + 1]).toBe('--no-daemon');

    // Additional networks are surfaced for a follow-up connect.
    expect(extraNetworks).toEqual(['monitoring']);
  });

  it('omits restart when policy is "no" and handles empty config', () => {
    const { args, extraNetworks } = buildDockerRunArgs({
      Name: '/tmp1',
      Config: { Image: 'alpine' },
      HostConfig: { RestartPolicy: { Name: 'no' } },
    });
    expect(args).not.toContain('--restart');
    expect(args).not.toContain('-p');
    expect(args[args.length - 1]).toBe('alpine');
    expect(extraNetworks).toEqual([]);
  });

  it('encodes on-failure retry count', () => {
    const { args } = buildDockerRunArgs({
      Config: { Image: 'alpine' },
      HostConfig: { RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 } },
    });
    expect(args).toEqual(expect.arrayContaining(['--restart', 'on-failure:5']));
  });

  it('throws when there is no image', () => {
    expect(() => buildDockerRunArgs({ Config: {} })).toThrow();
  });
});
