import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../');

function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Logging a session token to the console leaks it into browser dev tools,
// screen recordings and error-reporting tools. Guard against reintroduction.
const TOKEN_LOG_RE = /console\.(?:log|debug|info|warn|error)\([^)]*\btoken\b/i;

describe('no token logging', () => {
  it('never logs auth tokens to the console', () => {
    const files = [
      ...collectSourceFiles(join(repoRoot, 'server/src')),
      ...collectSourceFiles(join(repoRoot, 'web/src')),
    ];
    // Sanity check we actually found the source tree.
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, i) => {
        if (TOKEN_LOG_RE.test(line)) {
          offenders.push(`${file.replace(repoRoot, '')}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `Token logged to console:\n${offenders.join('\n')}`).toEqual([]);
  });
});
