import { describe, it, expect } from 'vitest';
import { normalizePath } from './path-normalize.js';

const DATA = '/home/me/homer/data';

describe('normalizePath', () => {
  it('leaves paths already under the current data dir untouched', () => {
    expect(normalizePath(`${DATA}/projects/app/docker-compose.yml`, DATA))
      .toBe(`${DATA}/projects/app/docker-compose.yml`);
  });

  it('remaps the docker data prefix', () => {
    expect(normalizePath('/app/data/projects/app/docker-compose.yml', DATA))
      .toBe(`${DATA}/projects/app/docker-compose.yml`);
  });

  it('remaps a data dir from another machine using the projects layout', () => {
    expect(normalizePath('/old/box/homer/data/projects/app/docker-compose.yml', DATA))
      .toBe(`${DATA}/projects/app/docker-compose.yml`);
  });

  it('does NOT rewrite unrelated paths that merely contain a data segment', () => {
    // Regression: indexOf('/data/') used to mangle this into the data dir.
    expect(normalizePath('/home/user/data/app/docker-compose.yml', DATA))
      .toBe('/home/user/data/app/docker-compose.yml');
  });

  it('anchors on the last projects marker', () => {
    expect(normalizePath('/data/projects/x/data/projects/app/compose.yml', DATA))
      .toBe(`${DATA}/projects/app/compose.yml`);
  });

  it('passes through null', () => {
    expect(normalizePath(null, DATA)).toBeNull();
  });
});
