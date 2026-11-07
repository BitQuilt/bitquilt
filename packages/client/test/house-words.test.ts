import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The house second opinion's words (docs/DEPLOY.md, "The house second opinion"). The compose file runs
 * `deploy/house.sh` as two services, `house` and `house-openai`, and sets no `HOUSE_EVERY`, so each waits house.sh's
 * default between passes. The default is held here at 300 seconds, since the documents also say it in words, five
 * minutes, which no pattern reads. The files that say how the houses run now name both services, give `HOUSE_EVERY` no
 * number but that default, and bring both up with every `up -d` that names one. These words drifted three times while
 * one house became two and the pass went from fifteen minutes to five; JOURNEY-AUDIT.md is a dated record of a walk and
 * is not read.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const SAYING = [
  'docs/DEPLOY.md',
  'deploy/README.md',
  'deploy/docker-compose.yml',
  'deploy/env.example',
  'deploy/house.sh',
  'examples/README.md',
];

/** The services of a compose file, by name, each with the lines under it. */
function services(compose: string): Map<string, string> {
  const body = compose.slice(compose.indexOf('\nservices:\n'));
  const out = new Map<string, string>();
  let name: string | null = null;
  for (const line of body.split('\n').slice(2)) {
    if (/^\S/.test(line)) break;
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) out.set((name = head[1]!), '');
    else if (name) out.set(name, `${out.get(name)!}${line}\n`);
  }
  return out;
}

describe('the house second opinion', () => {
  const every = /EVERY="\$\{HOUSE_EVERY:-(\d+)\}"/.exec(read('deploy/house.sh'))?.[1];

  it('runs as two services from one loop, and the compose file leaves the wait to the loop', () => {
    const houses = [...services(read('deploy/docker-compose.yml'))].filter(([, body]) =>
      body.includes('deploy/house.sh'),
    );
    expect(houses.map(([name]) => name)).toEqual(['house', 'house-openai']);
    for (const [, body] of houses) expect(body).not.toMatch(/^\s+HOUSE_EVERY:/m);
    expect(every).toBe('300');
  });

  it('is named as both services, with the one wait, in every file that says how it runs', () => {
    for (const path of SAYING) {
      const text = read(path);
      expect(text, path).toContain('house-openai');
      for (const m of text.matchAll(/HOUSE_EVERY[^.;\n]*?\b(\d+)\b/g)) expect(m[1], `${path}: ${m[0]}`).toBe(every);
    }
  });

  it('is brought up as both services wherever one is', () => {
    for (const path of [...SAYING, 'README.md']) {
      for (const m of read(path).matchAll(/up -d ([^`)\n;,]*)/g)) {
        const named = m[1]!.trim().split(/\s+/);
        if (named.includes('house')) expect(named, `${path}: ${m[0]}`).toContain('house-openai');
      }
    }
  });
});
