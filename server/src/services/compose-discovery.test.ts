import { describe, it, expect } from 'vitest';
import { groupComposeProjects, findRelativePathRefs, matchStackPath, type DiscoveredComposeProject } from './compose-discovery.js';

function labels(project: string, service: string, configFiles: string, workingDir?: string): Record<string, string> {
  return {
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
    'com.docker.compose.project.config_files': configFiles,
    ...(workingDir ? { 'com.docker.compose.project.working_dir': workingDir } : {}),
  };
}

describe('groupComposeProjects', () => {
  it('groups containers of the same project and counts them', () => {
    const result = groupComposeProjects([
      labels('myapp', 'web', '/srv/myapp/docker-compose.yml', '/srv/myapp'),
      labels('myapp', 'db', '/srv/myapp/docker-compose.yml', '/srv/myapp'),
      labels('other', 'api', '/opt/other/compose.yaml'),
    ]);
    expect(result).toHaveLength(2);
    const myapp = result.find(p => p.name === 'myapp');
    expect(myapp).toMatchObject({ containerCount: 2, configFiles: ['/srv/myapp/docker-compose.yml'], workingDir: '/srv/myapp' });
    expect(result.find(p => p.name === 'other')).toMatchObject({ containerCount: 1, workingDir: null });
  });

  it('keeps multiple config files in order', () => {
    const result = groupComposeProjects([
      labels('multi', 'web', '/srv/multi/docker-compose.yml,/srv/multi/docker-compose.override.yml'),
    ]);
    expect(result[0].configFiles).toEqual(['/srv/multi/docker-compose.yml', '/srv/multi/docker-compose.override.yml']);
  });

  it('skips containers without compose labels', () => {
    expect(groupComposeProjects([null, undefined, { foo: 'bar' }, {}])).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(groupComposeProjects([])).toEqual([]);
  });
});

function stack(name: string, configFiles: string[]): DiscoveredComposeProject {
  return { name, configFiles, workingDir: null, containerCount: 1 };
}

describe('matchStackPath', () => {
  it('matches by compose project name and returns the moved config file', () => {
    const stacks = [stack('expenses-app', ['/home/malko/git/alphonse/expanses/docker-compose.yml'])];
    const match = matchStackPath(stacks, {
      composeProject: 'expenses-app',
      storedPath: '/home/malko/git/alphonse/expanses/expenses-app/docker-compose.yml',
    });
    expect(match).toBe('/home/malko/git/alphonse/expanses/docker-compose.yml');
  });

  it('ignores the excluded project (Homer itself)', () => {
    const stacks = [stack('homer', ['/home/malko/homer/docker-compose.yml'])];
    expect(matchStackPath(stacks, {
      composeProject: 'homer',
      storedPath: '/old/homer/docker-compose.yml',
      excludeProject: 'homer',
    })).toBeNull();
  });

  it('never suggests the currently stored path', () => {
    const stacks = [stack('app', ['/srv/app/docker-compose.yml'])];
    expect(matchStackPath(stacks, {
      composeProject: 'app',
      storedPath: '/srv/app/docker-compose.yml',
    })).toBeNull();
  });

  it('skips excluded config files', () => {
    const stacks = [stack('app', ['/srv/app/docker-compose.yml'])];
    expect(matchStackPath(stacks, {
      composeProject: 'app',
      storedPath: '/old/app/docker-compose.yml',
      excludePaths: new Set(['/srv/app/docker-compose.yml']),
    })).toBeNull();
  });

  it('falls back to the compose file basename when the project name is unknown', () => {
    const stacks = [stack('renamed', ['/opt/renamed/docker-compose.yml'])];
    expect(matchStackPath(stacks, {
      composeProject: null,
      storedPath: '/srv/old/docker-compose.yml',
    })).toBe('/opt/renamed/docker-compose.yml');
  });

  it('returns null when nothing matches', () => {
    const stacks = [stack('other', ['/srv/other/docker-compose.yml'])];
    expect(matchStackPath(stacks, {
      composeProject: 'app',
      storedPath: '/srv/app/docker-compose.yml',
    })).toBeNull();
  });
});

describe('findRelativePathRefs', () => {
  it('finds relative volume and env_file references', () => {
    const yaml = [
      'services:',
      '  web:',
      '    image: nginx',
      '    volumes:',
      '      - ./html:/usr/share/nginx/html',
      '      - ../shared:/shared',
      '      - /abs/path:/abs',
      '    env_file: ./web.env',
    ].join('\n');
    const refs = findRelativePathRefs(yaml);
    expect(refs).toEqual([
      '- ./html:/usr/share/nginx/html',
      '- ../shared:/shared',
      'env_file: ./web.env',
    ]);
  });

  it('ignores comments and absolute paths', () => {
    const yaml = [
      '# - ./commented:/x',
      'volumes:',
      '  - /data/app:/app',
    ].join('\n');
    expect(findRelativePathRefs(yaml)).toEqual([]);
  });
});
