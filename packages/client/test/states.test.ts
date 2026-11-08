/**
 * The states in which a returned piece counts as accepted so far (CORE.md section 6: within the challenge window, and
 * after it) are said once in the client: ACCEPTED_STATES in listings.ts, beside LayerState. The away run's summary,
 * the return's words and the count of what the accepted squares found read that one list. A line of the client's src
 * that names both accepted states and no third is that list; the set a square stands in, which adds challenged
 * (render.ts), and the gold due (gold.ts) are other rules and name a third. The card (window/) keeps its own sum, since
 * what it imports is bundled into it and would change its hashed address.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { State } from '@bitquilt/core';
import { describe, expect, it } from 'vitest';
import { ACCEPTED_STATES, type LayerPiece } from '../src/listings.js';
import { STATE_WORDS, foundIn } from '../src/render.js';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Each line of the client's src, the generated card aside, that names in quotes exactly the two accepted states. */
function saidByHand(): string[] {
  const states = Object.keys(STATE_WORDS);
  const out: string[] = [];
  for (const file of readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.generated.ts')))
    readFileSync(join(src, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const named = new Set(states.filter((s) => line.includes(`'${s}'`) || line.includes(`"${s}"`)));
        if (named.size === 2 && named.has('accepted') && named.has('accepted_provisional'))
          out.push(`${file}:${i + 1}`);
      });
  return out;
}

/** A piece the count reads: its hash, the core's state, and an agreed accepting set that found `status`. */
const piece = (hash: string, state: string, status: string) => ({
  piece: {
    hash,
    agree: ['status'],
    schema: { type: 'object', properties: { status: { enum: ['proved', 'open'] } } },
  },
  state,
  accepting: { kind: 'agree', reveals: [{ return: { status } }] },
});

describe('the accepted states', () => {
  it('are accepted within the window and accepted', () => {
    expect(ACCEPTED_STATES).toEqual(['accepted_provisional', 'accepted']);
  });

  it("are said by hand on one line of the client's src, the list's own", () => {
    const declared = readFileSync(join(src, 'listings.ts'), 'utf8')
      .split('\n')
      .findIndex((line) => line.startsWith('export const ACCEPTED_STATES'));
    expect(saidByHand()).toEqual([`listings.ts:${declared + 1}`]);
  });

  it("count what the accepted squares found by the state shown: the tracker's where it answered, else the core's", () => {
    const state = {
      pieces: [
        piece('sha256:a', 'accepted', 'proved'),
        piece('sha256:b', 'accepted_provisional', 'proved'),
        piece('sha256:c', 'needs_verify', 'open'),
        piece('sha256:d', 'accepted_provisional', 'open'),
      ],
    } as unknown as State;
    const layer = [
      { hash: 'sha256:b', state: 'challenged' },
      { hash: 'sha256:c', state: 'accepted_provisional' },
    ] as unknown as LayerPiece[];
    expect(foundIn(state, layer)).toEqual({ status: { proved: 1, open: 2 } });
    expect(foundIn(state, null)).toEqual({ status: { proved: 2, open: 1 } });
  });
});
