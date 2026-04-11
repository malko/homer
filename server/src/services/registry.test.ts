import { describe, it, expect } from 'vitest';
import { parseImageRef, getRemoteDigest, getLocalDigest, checkImageUpdate, checkImageUpdateWithPolicy, type AutoUpdatePolicy } from '../services/registry.js';

describe('parseImageRef', () => {
  it('should parse docker hub images', () => {
    expect(parseImageRef('nginx:latest')).toEqual({
      registry: 'registry-1.docker.io',
      repository: 'library/nginx',
      tag: 'latest',
    });
  });

  it('should parse images with version tags', () => {
    expect(parseImageRef('nginx:1.21')).toEqual({
      registry: 'registry-1.docker.io',
      repository: 'library/nginx',
      tag: '1.21',
    });
  });

  it('should parse images with registry prefix', () => {
    expect(parseImageRef('ghcr.io/user/app:v1.0.0')).toEqual({
      registry: 'ghcr.io',
      repository: 'user/app',
      tag: 'v1.0.0',
    });
  });

  it('should parse images with port in registry', () => {
    expect(parseImageRef('localhost:5000/myimage:latest')).toEqual({
      registry: 'localhost:5000',
      repository: 'myimage',
      tag: 'latest',
    });
  });

  it('should handle images with digest', () => {
    const result = parseImageRef('nginx@sha256:abc123');
    expect(result.registry).toBe('registry-1.docker.io');
    expect(result.repository).toBe('library/nginx');
    expect(result.tag).toBe('latest');
  });

  it('should default to latest tag', () => {
    expect(parseImageRef('nginx')).toEqual({
      registry: 'registry-1.docker.io',
      repository: 'library/nginx',
      tag: 'latest',
    });
  });
});

describe('getRemoteDigest', () => {
  it('should return null for invalid image', async () => {
    const result = await getRemoteDigest('nonexistent-image-123456789');
    expect(result).toBeNull();
  });
});

describe('getLocalDigest', () => {
  it('should return null for non-existent image', async () => {
    const result = await getLocalDigest('nonexistent-image-123456789');
    expect(result).toBeNull();
  });
});

describe('checkImageUpdate', () => {
  it('should return hasUpdate false for non-existent image', async () => {
    const result = await checkImageUpdate('nonexistent-image-123456789');
    expect(result.hasUpdate).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('checkImageUpdateWithPolicy', () => {
  it('should return hasUpdate false for disabled policy', async () => {
    const result = await checkImageUpdateWithPolicy('nginx:latest', 'disabled');
    expect(result.hasUpdate).toBe(false);
  });

  it('should return hasUpdate false for nonexistent image', async () => {
    const result = await checkImageUpdateWithPolicy('nonexistent-image-123456789', 'all');
    expect(result.hasUpdate).toBe(false);
  });
});