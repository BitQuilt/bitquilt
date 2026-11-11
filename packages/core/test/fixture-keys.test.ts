/**
 * The keys of what a fixture of reading 2 lists, which docs/v2/READING.md section 11 leaves to the fixtures. The
 * fixtures' README writes them out under The keys, so a second implementation takes none from the JSON, and this test
 * holds the README to every file there: each key an answer holds is named, and a lock, a gold, a commitment, a
 * challenge, a panel and a proposal have the keys their sentences give and no others.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const folder = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/reading-2');
const readme = readFileSync(join(folder, 'README.md'), 'utf8');
const form = readme.split('## What is expected')[1]!.split('## The reasons')[0]!;
const named = new Set([...form.matchAll(/`([A-Za-z_]+)`/g)].map((m) => m[1]!));

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
// What a signer wrote is the signer's: a return, a gold's projection and a proposed piece are not the read's to shape.
const SIGNED = new Set(['return', 'projection', 'value']);
const isObject = (v: Json): v is { [k: string]: Json } => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every key under a value, and the keys each listed thing was seen with, by the list's name. */
function walk(v: Json, seen: Set<string>): void {
  if (Array.isArray(v)) for (const x of v) walk(x, seen);
  else if (isObject(v))
    for (const [k, x] of Object.entries(v)) {
      seen.add(k);
      if (!SIGNED.has(k) && !(k === 'piece' && isObject(x))) walk(x, seen);
    }
}

const seen = new Set<string>();
const things: Record<string, Set<string>> = { lock: new Set(), gold: new Set(), commitment: new Set() };
for (const k of ['challenge', 'panel', 'proposal']) things[k] = new Set();
for (const file of readdirSync(folder).filter((f) => f.endsWith('.json'))) {
  const fixture = JSON.parse(readFileSync(join(folder, file), 'utf8')) as { readings: { expect: Json }[] };
  for (const { expect: said } of fixture.readings) {
    const problems = (said as { problems: Record<string, Record<string, Json>> }).problems;
    for (const p of Object.values(problems)) {
      for (const [k, v] of Object.entries(p)) {
        if (k === 'pieces') continue;
        seen.add(k);
        walk(v, seen);
      }
      const each = (list: Json, into: string) => {
        for (const x of list as { [k: string]: Json }[]) for (const k of Object.keys(x)) things[into]!.add(k);
      };
      each(p.locks!, 'lock');
      each(p.golds!, 'gold');
      for (const g of p.golds as { commitments: Json }[]) each(g.commitments, 'commitment');
      each(p.challenges!, 'challenge');
      each(p.panels!, 'panel');
      each(p.proposals!, 'proposal');
    }
  }
}

it("the fixtures' README names every key an answer holds", () => {
  expect([...seen].filter((k) => !named.has(k))).toEqual([]);
});

it('a lock, a gold, a commitment, a challenge, a panel and a proposal have the keys the README gives, and no others', () => {
  const section = readme.split('## The keys')[1]!.split('\n## ')[0]!;
  for (const [thing, held] of Object.entries(things)) {
    const sentence = new RegExp(`A ${thing} is ([^.]*)\\.`).exec(section)![1]!;
    const listed = [...sentence.matchAll(/`([A-Za-z_]+)`/g)].map((m) => m[1]!);
    expect(listed.sort(), thing).toEqual([...held].sort());
  }
});
