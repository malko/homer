import { describe, it, expect } from 'vitest';

const LOCAL_DOMAINS = ['.home', '.local', '.lan'];

function isLocalDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return LOCAL_DOMAINS.some(d => hostname.endsWith(d));
  } catch {
    return false;
  }
}

function findFaviconLink(html: string, baseUrl: string): string | null {
  const linkRe = /<link([^>]+)>/gi;
  const relRe = /rel=["']([^"']+)["']/i;
  const hrefRe = /href=["']([^"']+)["']/i;
  const iconRels = new Set(['icon', 'shortcut icon', 'apple-touch-icon']);
  let m;
  while ((m = linkRe.exec(html))) {
    const attrs = m[1];
    const relM = relRe.exec(attrs);
    if (!relM || !iconRels.has(relM[1].toLowerCase())) continue;
    const hrefM = hrefRe.exec(attrs);
    if (!hrefM) continue;
    try { return new URL(hrefM[1], baseUrl).href; } catch {}
  }
  return null;
}

describe('isLocalDomain', () => {
  it('should detect .home domains', () => {
    expect(isLocalDomain('https://service.home')).toBe(true);
    expect(isLocalDomain('http://unas.home:9999')).toBe(true);
  });

  it('should detect .local domains', () => {
    expect(isLocalDomain('http://service.local')).toBe(true);
  });

  it('should reject public domains', () => {
    expect(isLocalDomain('https://google.com')).toBe(false);
    expect(isLocalDomain('https://example.org')).toBe(false);
  });

  it('should detect .lan domains', () => {
    expect(isLocalDomain('http://myservice.lan')).toBe(true);
  });
});

describe('findFaviconLink', () => {
  it('should find icon link in HTML', () => {
    const html = '<link rel="icon" href="/favicon.ico">';
    const href = findFaviconLink(html, 'http://example.com');
    expect(href).toBe('http://example.com/favicon.ico');
  });

  it('should handle absolute href', () => {
    const html = '<link rel="icon" href="/favicon.ico">';
    const href = findFaviconLink(html, 'http://example.com/app');
    expect(href).toBe('http://example.com/favicon.ico');
  });

  it('should find apple-touch-icon', () => {
    const html = '<link rel="apple-touch-icon" href="/icon.png">';
    const href = findFaviconLink(html, 'http://example.com');
    expect(href).toBe('http://example.com/icon.png');
  });

  it('should return null when no icon link', () => {
    const html = '<html><body>No icons here</body></html>';
    const href = findFaviconLink(html, 'http://example.com');
    expect(href).toBeNull();
  });
});