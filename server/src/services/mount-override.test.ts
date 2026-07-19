import { describe, it, expect } from 'vitest';
import { buildMountGuide } from './mount-override.js';
import type { ComposeInfo } from './container-recreate.js';

const OWN: ComposeInfo = {
  project: 'homer',
  service: 'homer',
  configFiles: ['/home/user/homer/docker-compose.yml'],
  workingDir: '/home/user/homer',
};

describe('buildMountGuide', () => {
  it('builds override content, file path and up command from own stack info', () => {
    const guide = buildMountGuide(['/srv/appb', '/srv/appa'], OWN);
    expect(guide.dirs).toEqual(['/srv/appa', '/srv/appb']);
    expect(guide.overrideFile).toBe('/home/user/homer/docker-compose.override.yml');
    expect(guide.overrideContent).toBe(
      'services:\n  homer:\n    volumes:\n      - /srv/appa:/srv/appa\n      - /srv/appb:/srv/appb\n'
    );
    expect(guide.upCommand).toBe('cd /home/user/homer && docker compose up -d');
    expect(guide.overrideExists).toBe(false);
  });

  it('dedups directories', () => {
    const guide = buildMountGuide(['/srv/app', '/srv/app'], OWN);
    expect(guide.dirs).toEqual(['/srv/app']);
  });

  it('reuses an existing override file and its -f flags', () => {
    const own: ComposeInfo = {
      ...OWN,
      configFiles: ['/home/user/homer/docker-compose.yml', '/home/user/homer/docker-compose.override.yml'],
    };
    const guide = buildMountGuide(['/srv/app'], own);
    expect(guide.overrideExists).toBe(true);
    expect(guide.overrideFile).toBe('/home/user/homer/docker-compose.override.yml');
    expect(guide.upCommand).toBe(
      'cd /home/user/homer && docker compose -f /home/user/homer/docker-compose.yml -f /home/user/homer/docker-compose.override.yml up -d'
    );
  });

  it('repeats -f flags for a non auto-loaded compose file name', () => {
    const own: ComposeInfo = { ...OWN, configFiles: ['/home/user/homer/my-stack.yml'] };
    const guide = buildMountGuide(['/srv/app'], own);
    expect(guide.overrideFile).toBe('/home/user/homer/docker-compose.override.yml');
    expect(guide.upCommand).toBe(
      'cd /home/user/homer && docker compose -f /home/user/homer/my-stack.yml -f /home/user/homer/docker-compose.override.yml up -d'
    );
  });

  it('falls back to generic content when own stack is unknown', () => {
    const guide = buildMountGuide(['/srv/app'], null);
    expect(guide.overrideFile).toBeNull();
    expect(guide.upCommand).toBeNull();
    expect(guide.overrideContent).toContain('  homer:\n');
    expect(guide.overrideContent).toContain('- /srv/app:/srv/app');
  });
});
