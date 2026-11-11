import { type LayerState, carriesSet, countsAsAccepted } from '@bitquilt/core';
import { describe, expect, it } from 'vitest';

/**
 * The layer's two groups of states, each said once beside LayerState (QX-1): a piece counts as accepted while its set
 * stands, provisionally or not, with no challenge open on it, which the directory row and the offer count; and a
 * piece still carries its accepting set under an open challenge too, which seeding and the square page read. Every
 * state the layer gives is asked, and no other is in either group: an inherited piece (QX-23 section 2) is in
 * neither, since its set is the problem's where the square stands.
 */
const STATES = [
  'locked',
  'unknown',
  'open',
  'in_flight',
  'sealed',
  'needs_verify',
  'disputed',
  'accepted_provisional',
  'accepted',
  'unreachable',
  'challenged',
  'judging',
  'recording',
  'recorded',
  'inherited',
] as const satisfies readonly LayerState[];
/** True only where STATES names every state the layer gives. */
const everyState: Exclude<LayerState, (typeof STATES)[number]> extends never ? true : false = true;

describe("the layer's state groups", () => {
  it('counts accepted and accepted_provisional as accepted, and nothing else', () => {
    expect(everyState).toBe(true);
    expect(STATES.filter(countsAsAccepted)).toEqual(['accepted_provisional', 'accepted']);
  });

  it('says a piece carries its set when it counts as accepted or is challenged, and nothing else', () => {
    expect(STATES.filter(carriesSet)).toEqual(['accepted_provisional', 'accepted', 'challenged']);
  });
});
