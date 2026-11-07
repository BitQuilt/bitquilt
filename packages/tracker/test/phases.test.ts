import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The phases of the layer (challenge.ts: QX-1, with QX-15, QX-16, QX-17 and QX-19 section 4 folded in): the file's
 * header lists the phases challengeLayer marks in its body, in the same order, and every section a phase in the body
 * cites, the same phase in the header cites too. The header is the map a reader opens the file by, and it once listed
 * six phases where the body ran seven.
 */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'challenge.ts'), 'utf8');
const header = source.slice(0, source.indexOf('*/'));
const start = source.indexOf('export function challengeLayer(');
const body = source.slice(start, source.indexOf('\n}\n', start));

/** The numbered phases of the header, each with its continuation lines joined. */
function headerPhases(): Map<number, string> {
  const out = new Map<number, string>();
  let last = 0;
  for (const line of header.split('\n')) {
    const item = /^ \* {3}(\d+)\. (.*)$/.exec(line);
    if (item) {
      last = Number(item[1]);
      out.set(last, item[2]!);
    } else if (last && /^ \* {6}\S/.test(line)) out.set(last, `${out.get(last)} ${line.slice(8)}`);
    else last = 0;
  }
  return out;
}

/** The numbered phases the body marks, each with the first line of its comment. */
function bodyPhases(): Map<number, string> {
  return new Map([...body.matchAll(/^ {2}\/\/ (\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]!]));
}

const cited = (text: string): string[] => [...text.matchAll(/(?:QX-\d+|verifiers\.md) section \d+/g)].map((m) => m[0]);

describe('the phases of the layer', () => {
  it('are the same in the header and the body, in order, the set-aside of QX-19 among them', () => {
    const head = headerPhases(),
      run = bodyPhases();
    expect(run.size).toBe(7);
    expect([...head.keys()]).toEqual([...run.keys()]);
    expect([...run.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(cited(head.get(3)!)).toContain('QX-19 section 4');
  });
  it('cite in the header every section the body cites for the same phase', () => {
    const head = headerPhases();
    for (const [n, text] of bodyPhases())
      for (const section of cited(text)) expect(cited(head.get(n) ?? ''), `phase ${n}`).toContain(section);
  });
});
