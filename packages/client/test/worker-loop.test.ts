import { describe, expect, it } from 'vitest';
import { textIssues } from '@bitquilt/core';
import { gateRefusal, instruction, parseArgs, plain, question, readPiece, schemaOf } from '../../../examples/worker-loop.mjs';

/**
 * The loop the workers with no person beside them share (examples/worker-loop.mjs): the flags, the piece read from
 * what the CLI prints, the schema the answer takes, and the words the model is given. The one call to a model is the
 * vendor file's own and is not called here.
 */
describe('the workers\' shared loop', () => {
  it('reads the flags: the problem and the evidence by position, the model and the cap by name, the two switches', () => {
    expect(parseArgs(['sha256:ab', 'paper.txt', '--model', 'm1', '--max', '3', '--second-only'], 'd')).toEqual({ problem: 'sha256:ab', evidenceFile: 'paper.txt', model: 'm1', max: 3, secondOnly: true, all: false });
    expect(parseArgs(['--all', '--second-only', '--max', '20'], 'd')).toEqual({ problem: undefined, evidenceFile: undefined, model: 'd', max: 20, secondOnly: true, all: true });
    expect(parseArgs(['--second-only', 'sha256:cd'], 'd').problem).toBe('sha256:cd');
  });
  it('reads the piece the CLI prints and makes its answer schema from the fields, enums kept and nothing else allowed', () => {
    const printed = 'Piece case/3 (sha256:0123abcd) on a problem.\nThe author wrote this brief: "Read the report."\nThe return is an object with these fields: {"sex":{"enum":["male","female","unknown"]},"age":{"type":"integer"},"quote":{"type":"string","maxLength":400},"covers":{"type":"array","maxItems":4,"items":{"enum":["a","b"]}}}; required: sex, quote; agreement is on: sex.\n';
    const piece = readPiece(printed)!;
    expect(piece).toMatchObject({ name: 'case/3', hash: 'sha256:0123abcd', brief: 'Read the report.', required: ['sex', 'quote'] });
    expect(schemaOf(piece)).toEqual({ type: 'object', additionalProperties: false, required: ['sex', 'age', 'quote', 'covers'], properties: { sex: { type: 'string', enum: ['male', 'female', 'unknown'] }, age: { type: 'integer' }, quote: { type: 'string' }, covers: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['a', 'b'] } } } });
    expect(readPiece('nothing like a piece')).toBeNull();
  });
  it('gives the model the brief as quoted words, the evidence when there is one, else what to do without it, and the fields', () => {
    const piece = readPiece('Piece a/1 (sha256:ab) x\nThe author wrote this brief: "Find the date."\nThe return is an object with these fields: {"date":{"type":"string"}}; required: date; agreement is on: date.\n')!;
    expect(question(piece, 'The paper says 1918.')).toBe('The author wrote this brief: "Find the date."\n\nThe evidence:\n\nThe paper says 1918.\n\nAnswer with the fields: date.');
    expect(question(piece, '', 'Find the source first.')).toContain('Find the source first.\n\nAnswer with the fields: date.');
    expect(question(piece, '')).toBe('The author wrote this brief: "Find the date."\n\nAnswer with the fields: date.');
    expect(instruction('')).toMatch(/^You work one piece of a problem/);
    expect(instruction('')).toContain('no links or web addresses');
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
    expect(gateRefusal('return: no links or markup')).toBe('no links or markup');
    expect(gateRefusal('return: no contact details')).toBe('no contact details');
    expect(gateRefusal('the tracker did not answer')).toBeNull();
  });
});
