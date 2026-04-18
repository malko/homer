import { describe, it, expect } from 'vitest';

const HOMER_SERVICES = 'homer-services';

function findBlockEnd(lines: string[], startIdx: number, minIndent: number): number {
  let idx = startIdx + 1;
  let lastContent = startIdx;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.trim() === '') { idx++; continue; }
    const indent = line.search(/\S/);
    if (indent < minIndent) break;
    lastContent = idx;
    idx++;
  }
  return lastContent + 1;
}

function addNetworkToService(lines: string[], serviceName: string): boolean {
  const serviceIdx = lines.findIndex(l => l.match(new RegExp(`^  ${serviceName}:\\s*$`)));
  if (serviceIdx === -1) return false;

  let idx = serviceIdx + 1;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.trim() === '') { idx++; continue; }
    const indent = line.search(/\S/);
    if (indent < 4) break;
    if (indent === 4 && line.match(/^    networks:\s*$/)) {
      let nextIdx = idx + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
      if (nextIdx < lines.length && lines[nextIdx].match(/^\s{6,}-\s/)) {
        const listEnd = findBlockEnd(lines, idx, 6);
        lines.splice(listEnd, 0, `      - ${HOMER_SERVICES}`);
      } else {
        const mapEnd = findBlockEnd(lines, idx, 6);
        lines.splice(mapEnd, 0, `      ${HOMER_SERVICES}:`);
      }
      return true;
    }
    idx++;
  }
  const insertAt = findBlockEnd(lines, serviceIdx, 4);
  lines.splice(insertAt, 0, `    networks:`, `      - ${HOMER_SERVICES}`);
  return true;
}

function addNetworkToExistingCompose(compose: string, targetServices: string[]): string {
  const lines = compose.split('\n');

  for (const serviceName of targetServices) {
    addNetworkToService(lines, serviceName);
  }

  const netIdx = lines.findIndex(l => l.match(/^networks:\s*$/));
  if (netIdx !== -1) {
    const insertAt = findBlockEnd(lines, netIdx, 2);
    lines.splice(insertAt, 0, `  ${HOMER_SERVICES}:`, `    external: true`);
  }

  return lines.join('\n');
}

function addNetworkToNewCompose(compose: string, targetServices: string[]): string {
  const lines = compose.split('\n');

  for (const serviceName of targetServices) {
    addNetworkToService(lines, serviceName);
  }

  lines.push('');
  lines.push('networks:');
  lines.push(`  ${HOMER_SERVICES}:`);
  lines.push('    external: true');
  lines.push('');

  return lines.join('\n');
}

describe('addNetworkToNewCompose', () => {
  it('should add networks section when none exists', () => {
    const compose = `services:
  web:
    image: nginx
    ports:
      - "80:80"
  db:
    image: postgres`;
    
    const result = addNetworkToNewCompose(compose, ['web', 'db']);
    
    expect(result).toContain('networks:');
    expect(result).toContain(`  ${HOMER_SERVICES}:`);
    expect(result).toContain('    external: true');
    expect(result).toContain('    networks:');
    expect(result).toContain(`      - ${HOMER_SERVICES}`);
  });

  it('should add network to minimal service', () => {
    const compose = `services:
  redis:
    image: redis`;
    
    const result = addNetworkToNewCompose(compose, ['redis']);
    
    expect(result).toContain('    networks:');
    expect(result).toContain(`      - ${HOMER_SERVICES}`);
  });
});

describe('addNetworkToExistingCompose', () => {
  it('should add network to existing list networks', () => {
    const compose = `services:
  web:
    image: nginx
    networks:
      - existing-net
  db:
    image: postgres
networks:
  existing-net:
    external: true`;
    
    const result = addNetworkToExistingCompose(compose, ['web', 'db']);
    
    expect(result).toContain(`  ${HOMER_SERVICES}:`);
    expect(result).toContain('    external: true');
    expect(result).toMatch(/networks:\s*\n\s+- existing-net\s*\n\s+- homer-services/);
  });

  it('should add network to existing map networks', () => {
    const compose = `services:
  app:
    image: myapp
    networks:
      frontend:
        aliases:
          - myapp.local
networks:
  frontend:
    external: true`;
    
    const result = addNetworkToExistingCompose(compose, ['app']);
    
    expect(result).toContain(`  ${HOMER_SERVICES}:`);
    expect(result).toMatch(/networks:\s*\n\s+frontend:\s*\n\s+aliases:\s*\n\s+- myapp.local\s*\n\s+homer-services:/);
  });

  it('should handle mixed services (some with networks, some without)', () => {
    const compose = `services:
  web:
    image: nginx
    ports:
      - "80:80"
  api:
    image: myapi
    networks:
      - internal
  worker:
    image: myworker
networks:
  internal:
    external: true`;
    
    const result = addNetworkToExistingCompose(compose, ['web', 'api', 'worker']);
    
    expect(result).toContain(`  ${HOMER_SERVICES}:`);
    expect(result).toMatch(/web:.*\n.*ports:.*\n.*networks:.*\n.*- homer-services/s);
    expect(result).toMatch(/api:.*\n.*networks:.*\n.*- internal.*\n.*- homer-services/s);
    expect(result).toMatch(/worker:.*\n.*networks:.*\n.*- homer-services/s);
  });
});