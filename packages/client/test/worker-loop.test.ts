import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { textIssues } from '@bitquilt/core';
import { type Hash, type Pick } from '@bitquilt/core';
import { REST_ASK, RESTS, fit, gateRefusal, instruction, parseArgs, pieceFrom, plain, question, refusal, schemaOf, schemaRefusal, stopOn, takeRests, traceSaid } from '../../../examples/worker-loop.mjs';
import type { Seam } from '../src/listings.js';
import { handedJson, seamsText } from '../src/render.js';

/** A piece as `quilt next --json` prints it, made by the client's own function and read back as the loop reads it. */
function handed(name: string, brief: string, properties: Record<string, unknown>, required: string[], seams: Seam[] = []) {
  const pick = { piece: { hash: 'sha256:ab', name, family: name.split('/')[0], n: 1, brief, verifier: 'agree', requires: ['web'], inputs: [] }, state: 'open', brief, schema: { type: 'object', additionalProperties: false, required, properties }, agree: [required[0]], requires: ['web'], lease_h: 2, availability: 1 } as unknown as Pick;
  return JSON.parse(JSON.stringify(handedJson({ hash: 'sha256:p' as Hash, pick, posted: { at: 'http://t/', queued: false }, owner: '0xowner', stake: 0, lock: null, seams }))) as Record<string, unknown>;
}

/**
 * The loop the workers with no person beside them share (examples/worker-loop.mjs): the flags, the piece read from
 * what `quilt next --json` prints, made here by the client's own function, the schema the answer takes, the words the
 * model is given, and a model's refusal marked so the loop declines the piece with the reason `refuse`. The one call to a model is the
 * vendor file's own and is not called here.
 */
describe('the workers\' shared loop', () => {
  it('reads the flags: the problem and the evidence by position, the model and the cap by name, the two switches', () => {
    expect(parseArgs(['sha256:ab', 'paper.txt', '--model', 'm1', '--max', '3', '--second-only'], 'd')).toEqual({ problem: 'sha256:ab', evidenceFile: 'paper.txt', model: 'm1', max: 3, secondOnly: true, all: false });
    expect(parseArgs(['--all', '--second-only', '--max', '20'], 'd')).toEqual({ problem: undefined, evidenceFile: undefined, model: 'd', max: 20, secondOnly: true, all: true });
    expect(parseArgs(['--second-only', 'sha256:cd'], 'd').problem).toBe('sha256:cd');
  });
  it('reads the piece the CLI prints and makes its answer schema from the fields, enums kept and nothing else allowed', () => {
    const piece = pieceFrom(handed('case/3', 'Read the report.', { sex: { enum: ['male', 'female', 'unknown'] }, age: { type: 'integer' }, quote: { type: 'string', maxLength: 400 }, covers: { type: 'array', maxItems: 4, items: { enum: ['a', 'b'] } } }, ['sex', 'quote']))!;
    expect(piece).toMatchObject({ name: 'case/3', hash: 'sha256:ab', brief: 'Read the report.', required: ['sex', 'quote'], seams: [] });
    const { rests, ...properties } = schemaOf(piece).properties;
    expect(rests).toEqual(RESTS);
    // A list says its most in words, since the structured shapes refuse maxItems; fit cuts a longer one to it.
    expect({ ...schemaOf(piece), properties }).toEqual({ type: 'object', additionalProperties: false, required: ['sex', 'age', 'quote', 'covers', 'rests'], properties: { sex: { type: 'string', enum: ['male', 'female', 'unknown'] }, age: { type: 'integer' }, quote: { type: 'string' }, covers: { type: 'array', description: 'At most 4 items', items: { type: 'string', enum: ['a', 'b'] } } } });
    expect(fit(piece, { sex: 'male', age: 3, quote: 'q', covers: ['a', 'b', 'a', 'b', 'a'] })).toEqual({ sex: 'male', age: 3, quote: 'q', covers: ['a', 'b', 'a', 'b'] });
    expect(pieceFrom({ problem: 'sha256:p', piece: 'sha256:ab', brief: 'A judge piece.', schema: null })).toBeNull();
    expect(pieceFrom(null)).toBeNull();
    // A date field says its shape in words, since the tracker holds it to YYYY-MM-DD.
    const dated = pieceFrom(handed('d/1', 'When.', { when: { format: 'date', maxLength: 10, type: 'string' }, note: { type: 'string' } }, ['when']))!;
    expect(schemaOf(dated).properties.when).toEqual({ type: 'string', description: 'A date as YYYY-MM-DD' });
    // A string field the piece does not require says it may be left empty, since the strict shape asks for every field; fit leaves an empty one out.
    expect(schemaOf(dated).properties.note).toEqual({ type: 'string', description: 'Empty where the record gives none' });
    const bill = pieceFrom(handed('b/1', 'When.', { last_action_date: { format: 'date', maxLength: 10, type: 'string' }, enacted_date: { format: 'date', maxLength: 10, type: 'string' }, notes: { type: 'string', maxLength: 400 }, n: { type: 'integer' } }, ['last_action_date']))!;
    expect(schemaOf(bill).properties.enacted_date).toEqual({ type: 'string', description: 'A date as YYYY-MM-DD, or empty where the record gives none' });
    expect(schemaOf(bill).properties.n).toEqual({ type: 'integer' });
    expect(fit(bill, { last_action_date: '', enacted_date: '', notes: ' ', n: 3 })).toEqual({ last_action_date: '', n: 3 });
    expect(fit(bill, { last_action_date: '2026-05-12', enacted_date: null, notes: 'x'.repeat(401) })).toEqual({ last_action_date: '2026-05-12', notes: 'x'.repeat(400) });
    expect(schemaRefusal('the tracker refused the reveal: return.last_action_date: a date, YYYY-MM-DD')).toBe('return.last_action_date: a date, YYYY-MM-DD');
    expect(schemaRefusal('return: no links or markup')).toBeNull();
    expect(schemaRefusal('nothing for this key on that problem right now')).toBeNull();
  });
  it('gives the model the brief as quoted words, the evidence when there is one, else what to do without it, and the fields', () => {
    const piece = pieceFrom(handed('a/1', 'Find the date.', { date: { type: 'string' } }, ['date']))!;
    expect(question(piece, 'The paper says 1918.')).toBe(`The author wrote this brief: "Find the date."\n\nThe evidence:\n\nThe paper says 1918.\n\nAnswer with the fields: date. ${REST_ASK}`);
    expect(question(piece, '', 'Find the source first.')).toContain('Find the source first.\n\nAnswer with the fields: date.');
    expect(question(piece, '')).toBe(`The author wrote this brief: "Find the date."\n\nAnswer with the fields: date. ${REST_ASK}`);
    // QX-19 section 4: the seams handed over go into the question, each line as quilt_next says it, every passage quoted with its signer named.
    const seam: Seam = { field: 'date', why: 'source', sides: [
      { key: '0xA', value: '1918', read: { url: 'https://example.org/p', hash: 'sha256:ab' as Hash, at: '2026-11-02T00:00:00Z' }, span: [0, 7], passage: 'in 1918', aside: false },
      { key: '0xB', value: '1919', read: { url: 'https://example.org/q', hash: 'sha256:cd' as Hash, at: '2026-11-02T00:00:00Z' }, span: [0, 7], passage: 'in 1919', aside: false },
    ] };
    const seamed = pieceFrom(handed('a/1', 'Find the date.', { date: { type: 'string' } }, ['date'], [seam]))!;
    expect(seamed.seams).toEqual(seamsText([seam], (k) => k));
    expect(seamed.seams![0]).toContain('"in 1918"');
    expect(question(seamed, '')).toBe(`The author wrote this brief: "Find the date."\n\nTwo earlier readings of this piece differ, and the tracker says where:\n${seamed.seams![0]}\n\nAnswer with the fields: date. ${REST_ASK}`);
    // A model's refusal is marked, so the loop declines the piece and takes the next; any other error is not.
    expect(refusal('claude refused this piece')).toMatchObject({ message: 'claude refused this piece', refusal: true });
    expect((new Error('openai 500') as Error & { refusal?: boolean }).refusal).toBeUndefined();
    expect(REST_ASK).toMatch(/^Under rests, /);
    expect(instruction('')).toMatch(/^You work one piece of a problem/);
    expect(instruction('')).toContain('no links or web addresses');
    // The rests are the one place an address goes, said so, since a model told no string holds one names the page by title there too and nothing can be fetched.
    expect(instruction('')).toContain('The rests are not part of the answer and are the one place an address goes');
    expect(instruction('Copy the words exactly.')).toMatch(/ Copy the words exactly\.$/);
  });
  it('takes addresses, domains, markup and handles out of an answer before it is signed, so the gate admits it, and leaves a title and an id alone', () => {
    const answer = {
      where_seen: 'Internet Archive, item ladieshomejourna116janwye, at https://archive.org/details/ladieshomejourna116janwye/page/12',
      how_found: 'Searched archive.org and www.hathitrust.org; see <b>the scan</b> and [the page](https://example.com/x) or write to someone@example.com or @hugo_oed',
      source: 'The Ladies\' Home Journal, volume 116, number 1, page 12; doi 10.1000/abc',
      year: 1971,
      found_earlier: 'no',
    };
    const clean = plain(answer);
    expect(clean.where_seen).toBe('Internet Archive, item ladieshomejourna116janwye, at [address removed]');
    expect(clean.how_found).toBe('Searched archive and [address removed]; see the scan and [the page] ([address removed]) or write to [address removed] or hugo_oed');
    expect(clean.source).toBe(answer.source);
    expect(clean.year).toBe(1971);
    for (const v of Object.values(clean)) if (typeof v === 'string') expect(textIssues(v)).toEqual([]);
  });
  it('takes the rests out of an answer, keeping only well-formed ones, and says in the log line what became of the trace', () => {
    const answer = { verdict: 'supports', rests: [{ field: 'verdict', url: 'https://example.org/p', passage: 'it holds' }, { field: 'quote', url: 'https://example.org/p', passage: '  ' }, 'no', { field: 1 }] };
    expect(takeRests(answer)).toEqual([{ field: 'verdict', url: 'https://example.org/p', passage: 'it holds' }]);
    expect(answer).toEqual({ verdict: 'supports' });
    expect(takeRests({ verdict: 'supports' })).toEqual([]);
    expect(traceSaid(null)).toBe('');
    expect(traceSaid({ posted: { queued: false, at: 'http://t/' }, reads: 1, rested: ['verdict'], missing: [] })).toBe(', trace posted: verdict on 1 read');
    expect(traceSaid({ posted: null, reads: 0, rested: [], missing: [{ field: 'verdict', url: 'u', why: 'the page answered 404' }] })).toBe(', no trace (left out: verdict: the page answered 404)');
    expect(traceSaid({ posted: { queued: false, error: 'read 0: no such blob here; put it first' }, reads: 1, rested: ['verdict'], missing: [] })).toBe(', trace refused: read 0: no such blob here; put it first: verdict on 1 read');
    // A passage the client could not place is named in the log by its first words and its page, so the miss can be read.
    const miss = [{ field: 'verdict', url: 'https://example.org/a', why: 'the passage is not on the page as fetched' }];
    expect(traceSaid({ posted: null, reads: 0, rested: [], missing: miss }, [{ field: 'verdict', url: 'https://example.org/a', passage: 'one two three four five six seven' }])).toBe(', no trace (left out: verdict: the passage is not on the page as fetched ("one two three four five six..." on example.org))');
    expect(traceSaid({ posted: null, reads: 0, rested: [], missing: miss }, [{ field: 'other', url: 'https://example.org/a', passage: 'x' }])).toBe(', no trace (left out: verdict: the passage is not on the page as fetched)');
    expect(gateRefusal('return: no links or markup')).toBe('no links or markup');
    expect(gateRefusal('return: no contact details')).toBe('no contact details');
    expect(gateRefusal('the tracker did not answer')).toBeNull();
  });
  it('reads a stop between pieces: the flag SIGTERM sets, so the piece in hand is finished and no other taken', () => {
    const signals = new EventEmitter();
    const stop = stopOn(signals);
    expect(stop.asked).toBe(false);
    signals.emit('SIGTERM');
    expect(stop.asked).toBe(true);
  });
});
