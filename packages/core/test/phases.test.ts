import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The steps of the read (read.ts; docs/v2/READING.md section 1: "The fold has eight steps, sections 2 to 9, in that
 * order."): the file's header lists the steps `read` marks in its body, in the same order, each numbered as its
 * section of the reading is and named by that section's heading, and every section a step in the body cites, the same
 * step in the header cites too. The header is the map a reader opens the file by, and it once listed six phases where
 * the body ran seven.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'read.ts'), 'utf8');
const reading = readFileSync(join(here, '..', '..', '..', 'docs', 'v2', 'READING.md'), 'utf8');
const header = source.slice(0, source.indexOf('*/'));
const start = source.indexOf('export function read(');
const body = source.slice(start, source.indexOf('\n}\n', start));

/** The numbered steps of the header, each with its continuation lines joined. */
function headerSteps(): Map<number, string> {
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

/** The numbered steps the body marks, each with the first line of its comment. */
function bodySteps(): Map<number, string> {
  return new Map([...body.matchAll(/^ {2}\/\/ (\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]!]));
}

/** The headings of the reading's sections, by number. */
function sections(): Map<number, string> {
  return new Map([...reading.matchAll(/^## (\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]!]));
}

const cited = (text: string): string[] => [...text.matchAll(/(?:QX-\d+|verifiers\.md) section \d+/g)].map((m) => m[0]);

describe('the steps of the read', () => {
  it('are the same in the header and the body, in order, the eight of the reading', () => {
    const head = headerSteps(),
      run = bodySteps();
    expect([...run.keys()]).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...head.keys()]).toEqual([...run.keys()]);
  });
  it("are each named by the heading of the reading's section of that number", () => {
    const head = headerSteps(),
      run = bodySteps(),
      named = sections();
    for (const n of run.keys()) {
      const name = named.get(n)!;
      expect(head.get(n)!.startsWith(name), `the header's step ${n}`).toBe(true);
      expect(run.get(n)!.startsWith(name), `the body's step ${n}`).toBe(true);
    }
  });
  it('cite in the header every section the body cites for the same step, the set-aside of QX-19 among them', () => {
    const head = headerSteps();
    expect(cited(head.get(4)!)).toContain('QX-19 section 4');
    for (const [n, text] of bodySteps())
      for (const section of cited(text)) expect(cited(head.get(n) ?? ''), `step ${n}`).toContain(section);
  });
});
