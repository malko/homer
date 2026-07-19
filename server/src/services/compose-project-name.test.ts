import { describe, it, expect } from 'vitest';
import { getComposeProjectName, getMountHint } from './compose-project-name.js';

describe('getComposeProjectName', () => {
  it('falls back to the compose file directory name', () => {
    expect(getComposeProjectName({ path: '/srv/myapp/docker-compose.yml' })).toBe('myapp');
    expect(getComposeProjectName({ path: '/srv/myapp/docker-compose.yml', compose_project: null })).toBe('myapp');
  });

  it('prefers the stored compose project name', () => {
    expect(getComposeProjectName({ path: '/srv/myapp/docker-compose.yml', compose_project: 'custom' })).toBe('custom');
  });
});

describe('getMountHint', () => {
  it('suggests an identical host/container mount of the compose directory', () => {
    expect(getMountHint('/srv/myapp/docker-compose.yml')).toContain('- /srv/myapp:/srv/myapp');
  });
});
