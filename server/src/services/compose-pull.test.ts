import { describe, it, expect } from 'vitest';
import { composePullChanged } from './compose-pull.js';

describe('composePullChanged', () => {
  it('reports a change when images were pulled or downloaded', () => {
    expect(composePullChanged(' ✔ web Pulled')).toBe(true);
    expect(composePullChanged('Downloaded newer image for nginx:latest')).toBe(true);
  });

  it('reports no change when everything is up to date', () => {
    expect(composePullChanged(' ✔ web Image is up to date')).toBe(false);
    expect(composePullChanged('')).toBe(false);
  });
});
