/**
 * PROTOCOL.md, The piece next hands over: what `quilt next --json` prints, held to handedJson (render.ts) over a piece
 * a tracker handed a Quilt. The sentence's three lists are read from it: the fields handedJson adds, which the table
 * under "### The piece next hands over" does not name; the kind's words, five fields the table names, which are the
 * keys of handedJson's `kind` in their order; and the fields it drops, which the table names. The table's fields, less
 * the kind's words and the dropped, with `kind` and the added, are handedJson's keys, no more and no fewer, and a seam
 * handed over is one line of words. packages/tracker/test/protocol-table.test.ts holds the table to the tracker's
 * answer, and cli-text.test.ts holds that the command line prints what handedJson makes.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Seam } from '../src/listings.js';
import type { Pattern, Quilt } from '../src/quilt.js';
import { handedJson } from '../src/render.js';
import { quiltOver, startTracker } from './helpers.js';

const DOC = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8');

const pattern: Pattern = {
  title: 'One statement, handed over',
  done_when: 'The statement has a verdict agreed by two vendors.',
  slug: 'next-json',
  pieces: {
    statement: {
      verifier: 'agree',
      requires: ['web'],
      brief: 'Does the statement hold? Answer holds or fails.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict'],
        properties: { verdict: { enum: ['holds', 'fails'] } },
      },
      agree: ['verdict'],
    },
  },
};

/** The names a text gives in backticks. */
const named = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** The fields the table under "### The piece next hands over" names, each row's first cell. */
function tableFields(): string[] {
  const lines = DOC.split('\n');
  const at = lines.indexOf('### The piece next hands over');
  if (at < 0) throw new Error('PROTOCOL.md has no heading ### The piece next hands over');
  const rows: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#')) break;
    if (line.startsWith('|')) rows.push(line);
    else if (rows.length) break;
  }
  return rows.slice(2).flatMap((row) => named(row.split('|')[1]!));
}

let server: Server;
/** The piece a tracker handed a Quilt, and handedJson's answer over it. */
let given: Awaited<ReturnType<Quilt['next']>>;
let handed: Record<string, unknown>;

beforeAll(async () => {
  const t = await startTracker();
  server = t.server;
  const mk = quiltOver(t.base);
  const problem = (await mk(9).publish(pattern)).hash;
  given = await mk(1, 'anthropic/claude').next(problem);
  handed = handedJson(given) as unknown as Record<string, unknown>;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('PROTOCOL.md, what `quilt next --json` prints', () => {
  it("adds, moves under `kind` and drops the fields the sentence names, and gives handedJson's keys", () => {
    const said =
      /`quilt next --json` prints the piece as `handedJson` in `packages\/client\/src\/render\.ts` makes it: it adds ([^;]+); gives `kind` as the kind's words, `\{ ([a-z_, ]+) \}`, in place of those five fields; gives `seams` as words; and drops ([^.]+)\./.exec(
        DOC,
      );
    expect(said, 'the sentence names the three lists').not.toBeNull();
    const [, addedText, kindText, droppedText] = said!;
    const added = named(addedText!);
    const words = kindText!.split(', ');
    const dropped = named(droppedText!);
    const table = tableFields();
    expect(table).toContain('piece');
    for (const f of added) expect(table, `${f} is added, so the table does not name it`).not.toContain(f);
    expect(words.length).toBe(5);
    for (const f of [...words, ...dropped]) expect(table, `the table names ${f}`).toContain(f);
    for (const f of dropped) expect(words, `${f} is dropped, not moved`).not.toContain(f);
    const kept = table.filter((f) => !words.includes(f) && !dropped.includes(f));
    expect(Object.keys(handed).sort()).toEqual([...kept, 'kind', ...added].sort());
    expect(Object.keys(handed.kind as Record<string, unknown>)).toEqual(words);
  });

  it('gives the seams as words', () => {
    const side = (key: string, value: string) => ({ key, value, read: null, span: null, passage: null });
    const seam: Seam = { field: 'verdict', why: 'unknown', sides: [side('Ada', 'holds'), side('Bo', 'fails')] };
    const seams = handedJson({ ...given, seams: [seam] }).seams;
    expect(seams).toEqual([
      'On verdict, one side rests on nothing kept: Ada rests it on nothing kept; Bo rests it on nothing kept.',
    ]);
    expect(handed.seams).toEqual([]);
  });
});
