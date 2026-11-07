import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Door (door.ts): the narrow set of effects a Quilt builds from its own signing, posting and reading and hands to
 * the files that work through it. The files door.ts's header names are the files that take it, and AGENTS.md names the
 * same, so a reader who asks where the home's key is used beyond quilt.ts finds every place. Both once said two files
 * where three took it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const named = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((m) => m[1]!).sort();

describe('the Door', () => {
  it('goes to the files its header and AGENTS.md name, and to no other', () => {
    const taking = readdirSync(src).filter((f) => f.endsWith('.ts') && f !== 'quilt.ts' && /from '\.\/door\.js'/.test(readFileSync(join(src, f), 'utf8'))).sort();
    expect(taking).toEqual(['coin.ts', 'gold.ts', 'trace.ts']);
    const header = readFileSync(join(src, 'door.ts'), 'utf8');
    expect(named(header.slice(0, header.indexOf(': ')), /\((\w+\.ts)\)/g)).toEqual(taking);
    const agents = readFileSync(join(here, '..', '..', '..', 'AGENTS.md'), 'utf8');
    const clause = agents.slice(0, agents.indexOf('through the `Door` in `door.ts`'));
    expect(named(clause.slice(clause.lastIndexOf(';')), /`(\w+\.ts)`/g)).toEqual(taking);
  });
});
