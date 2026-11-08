import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_EVENT_TYPES } from '@bitquilt/core';
import { identityDoor, problemDoor } from '../src/admit.js';
import { COIN_EVENTS } from '../src/coin.js';

/**
 * PROTOCOL.md, Events, held to the door. Its table gives the types the extensions add, the log each goes to and where
 * its rule is written; the door says the same in its maps, `problemDoor` and `identityDoor` in admit.ts, a row per
 * type with a comment that names where its rule is written, and in COIN_EVENTS in coin.ts, the coin log's one list,
 * whose comment names the coin layer's rule. The table's pairs of a type and its log are the types each log's door
 * takes beyond the core's, which CORE.md section 4 names, no more and no less; and each row's Rules cell names the
 * document and sections the door's comment names first for each of its types, where the comment names one. A
 * comment's later citation, as QX-16 section 4 for a challenge on a miss, says where a part of that type's rule is
 * written. admit.test.ts holds the maps to what the door answers.
 */
const read = (path: string): string =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PROTOCOL = read('docs/PROTOCOL.md');
const CORE = read('docs/CORE.md');

/** The lines under a heading of a document, up to the next heading of its level or above. */
function under(doc: string, heading: string): string[] {
  const lines = doc.split('\n');
  const level = /^#+/.exec(heading)![0].length;
  const at = lines.indexOf(heading);
  if (at < 0) throw new Error(`no heading ${heading}`);
  const end = lines.findIndex((l, i) => i > at && /^#+\s/.test(l) && /^#+/.exec(l)![0].length <= level);
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

/** The data rows of the first table among some lines, each a list of its cells, its header and rule left out. */
function table(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('|'))
      rows.push(
        line
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim()),
      );
    else if (rows.length) break;
  }
  return rows.slice(2);
}

/** The names a cell gives in code marks. */
const marked = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** A cell's text as a citation reads it: each link's text in place of the link. */
const unlinked = (text: string): string => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();

/**
 * The first citation a comment makes, as the code writes one: an extension's number or a document's name, then the
 * sections it names by number; or null where the comment cites nothing.
 */
const CITATION = /(?:QX-\d+|[A-Za-z][\w-]*\.md)(?: sections? \d+(?:\.\d+)*(?:(?:, | and | to )\d+(?:\.\d+)*)*)?/;
const firstCitation = (comment: string): string | null => CITATION.exec(comment)?.[0] ?? null;

/**
 * The comment each row of a door map in a source writes after its type, by type. The rows are read from the map's
 * object literal, one type a line, and held below to the keys the map exports.
 */
function rowComments(path: string, map: string): Map<string, string> {
  const text = read(path);
  const start = text.indexOf(`export const ${map}:`);
  expect(start, `${map} in ${path}`).toBeGreaterThanOrEqual(0);
  const body = text.slice(start, text.indexOf('\n};', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^ {2}(\w+): [\w.]+, \/\/ (.*)$/gm)) out.set(m[1]!, m[2]!);
  return out;
}

/** The comment above a declaration of a source, its stars and markers set aside, as one line of prose. */
function docComment(path: string, declaration: string): string {
  const text = read(path);
  const at = text.indexOf(declaration);
  expect(at, `${declaration} in ${path}`).toBeGreaterThanOrEqual(0);
  const close = text.lastIndexOf('*/', at);
  const open = text.lastIndexOf('/**', close);
  return text
    .slice(open + 3, close)
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .trim();
}

type Log = 'problem' | 'identity' | 'coin';

/** A row of PROTOCOL.md's Events table: its types, its log, and its Rules cell as a citation. */
interface Row {
  types: string[];
  log: string;
  rules: string;
}
const ROWS: Row[] = table(under(PROTOCOL, '## Events')).map(([types, log, , rules]) => ({
  types: marked(types!),
  log: log!,
  rules: unlinked(rules!),
}));

/** The core's types by the log each lives in, as CORE.md section 4 says in its table and in Where events live. */
function coreTypes(): Record<'problem' | 'identity', string[]> {
  const section = under(CORE, '## 4. The event line');
  const all = table(section).map(([type]) => marked(type!)[0]!);
  const live = section.find((l) => l.startsWith('**Where events live.**'));
  expect(live, 'CORE.md section 4, Where events live').toBeDefined();
  const sentence = live!.split('. ').find((s) => s.includes('the identity log'));
  const identity = marked(sentence ?? '').filter((t) => all.includes(t));
  return { problem: all.filter((t) => !identity.includes(t)), identity };
}
const CORE_TYPES = coreTypes();

/** The types each log's door takes, from the maps the door exports. */
const DOOR: Record<Log, string[]> = {
  problem: Object.keys(problemDoor),
  identity: Object.keys(identityDoor),
  coin: [...COIN_EVENTS],
};

/** Where the door's comment says each type's rule is written, by log and type, as its first citation. */
function doorCitations(): Record<Log, Map<string, string | null>> {
  const fromRows = (map: string) =>
    new Map([...rowComments('packages/tracker/src/admit.ts', map)].map(([t, c]) => [t, firstCitation(c)]));
  const coin = firstCitation(docComment('packages/tracker/src/coin.ts', 'export const COIN_EVENTS'));
  return {
    problem: fromRows('problemDoor'),
    identity: fromRows('identityDoor'),
    coin: new Map(DOOR.coin.map((t) => [t, coin])),
  };
}
const CITED = doorCitations();

/** A type and the log it goes to, as one string. */
const pair = (log: string, type: string): string => `${type} on ${log}`;

describe('PROTOCOL.md, Events, held to the door', () => {
  it("reads the core's types by their logs as CORE.md section 4 names them, the core's own list the same", () => {
    expect(CORE_TYPES.identity).toEqual(['name', 'delegate', 'revoke', 'rotate']);
    expect(CORE_TYPES.problem).toEqual(['claim', 'commit', 'reveal', 'decline', 'run', 'version', 'output']);
    expect([...CORE_TYPES.problem, ...CORE_TYPES.identity].sort()).toEqual([...CORE_EVENT_TYPES].sort());
  });

  it("has each log's door take the core's types of that log", () => {
    for (const log of ['problem', 'identity'] as const)
      expect(
        CORE_TYPES[log].filter((t) => !DOOR[log].includes(t)),
        log,
      ).toEqual([]);
  });

  it("gives the types each log's door takes beyond the core's, on that log, no more and no less", () => {
    expect(ROWS.length).toBeGreaterThan(5);
    const table = ROWS.flatMap((r) => r.types.map((t) => pair(r.log, t))).sort();
    const core = new Set<string>([...CORE_TYPES.problem, ...CORE_TYPES.identity]);
    const door = (Object.keys(DOOR) as Log[])
      .flatMap((log) => DOOR[log].filter((t) => !core.has(t)).map((t) => pair(log, t)))
      .sort();
    expect(table.filter((p, i) => table.indexOf(p) !== i)).toEqual([]);
    expect(table).toEqual(door);
  });

  it("reads every row's comment in the door's maps, one for each type the map exports", () => {
    expect([...rowComments('packages/tracker/src/admit.ts', 'problemDoor').keys()]).toEqual(DOOR.problem);
    expect([...rowComments('packages/tracker/src/admit.ts', 'identityDoor').keys()]).toEqual(DOOR.identity);
    expect(CITED.coin.get('pay')).toBe('QX-17 section 2');
  });

  it("names in each row's Rules where the door's comment says each of its types' rule is written", () => {
    const wrong = ROWS.flatMap((r) =>
      r.types.flatMap((t) => {
        const cited = CITED[r.log as Log]?.get(t);
        return cited && cited !== r.rules ? [`${pair(r.log, t)}: the table says ${r.rules}, the door ${cited}`] : [];
      }),
    );
    expect(wrong).toEqual([]);
    expect(ROWS.filter((r) => r.types.some((t) => CITED[r.log as Log]?.get(t)))).toHaveLength(ROWS.length);
  });

  it('reads a citation as the code writes one, and the first a comment makes', () => {
    expect(firstCitation('QX-1 section 1, and QX-16 section 4 for a challenge on a miss')).toBe('QX-1 section 1');
    expect(firstCitation('QX-13 sections 1 and 2')).toBe('QX-13 sections 1 and 2');
    expect(firstCitation('verifiers.md section 2, judge:n (QX-2)')).toBe('verifiers.md section 2');
    expect(firstCitation('What the coin log takes (QX-17 section 2): the one list')).toBe('QX-17 section 2');
    expect(firstCitation('the core checks the shape')).toBeNull();
    expect(unlinked('[QX-4](ext/QX-4.md) section 1')).toBe('QX-4 section 1');
  });
});
