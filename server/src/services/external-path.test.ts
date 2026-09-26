import { describe, it, expect } from 'vitest';
import { validateExternalComposePath } from './external-path.js';

const opts = {
  projectsDir: '/app/data/projects',
  ownConfigFiles: ['/home/malko/homer/docker-compose.yml'],
};

describe('validateExternalComposePath', () => {
  it('accepts an absolute path outside the data dir', () => {
    expect(validateExternalComposePath('/srv/app/docker-compose.yml', opts)).toEqual({ ok: true });
  });

  it('rejects a relative path', () => {
    expect(validateExternalComposePath('srv/app/docker-compose.yml', opts).ok).toBe(false);
  });

  it('rejects a path inside the projects dir', () => {
    expect(validateExternalComposePath('/app/data/projects/app/docker-compose.yml', opts).ok).toBe(false);
    expect(validateExternalComposePath('/app/data/projects', opts).ok).toBe(false);
  });

  it('does not reject a sibling whose name merely starts with the projects dir', () => {
    expect(validateExternalComposePath('/app/data/projects-archive/x.yml', opts).ok).toBe(true);
  });

  it("rejects Homer's own compose file", () => {
    expect(validateExternalComposePath('/home/malko/homer/docker-compose.yml', opts).ok).toBe(false);
  });
});
