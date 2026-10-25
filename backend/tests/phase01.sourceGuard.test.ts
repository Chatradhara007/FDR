import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return /\.(ts|sql)$/.test(d.name) ? [p] : [];
  });
}

const files = walk(SRC).map((p) => ({ rel: path.relative(SRC, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }));

describe('phase 01 — source guards', () => {
  it('AC10: only domain/stateMachine.ts updates instruments.status', () => {
    const offenders = files
      .filter((f) => f.rel !== 'domain/stateMachine.ts')
      .filter((f) => /\bSET\s+status\b/i.test(f.text) || /UPDATE\s+instruments\b[^;`]*?[\s,]status\s*=/is.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
    expect(files.find((f) => f.rel === 'domain/stateMachine.ts')!.text).toMatch(/SET status = \$1/);
  });

  it('only the clock (and listed infrastructure) reads wall time', () => {
    // Infrastructure exceptions: health timestamp, the first migration before app_clock exists, server startup wait.
    const allowed = new Set(['domain/clock.ts', 'services/healthService.ts', 'db/migrate.ts', 'server.ts']);
    const offenders = files
      .filter((f) => !allowed.has(f.rel))
      .filter((f) => /new Date\(\s*\)|Date\.now\(|\bnow\(\)|CURRENT_DATE|CURRENT_TIMESTAMP/i.test(f.text.replace(/clock\.now\(/g, '')))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
