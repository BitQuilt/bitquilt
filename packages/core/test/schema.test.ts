import { describe, expect, it } from 'vitest';
import { agreeFields, canonicaliseField, returnProblems, returnStrings, returnsAgree, scalarLength, schemaProblems, type Schema } from '../src/schema.js';

const cite: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'quote', 'page'],
  properties: {
    verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] },
    quote: { type: 'string', maxLength: 160 },
    page: { type: 'string', maxLength: 20 },
    score: { type: 'number', tolerance: 0.5 },
    when: { type: 'string', maxLength: 30, format: 'date' },
    tags: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 10 } },
  },
};

describe('the schema subset', () => {
  it('accepts the subset and nothing else', () => {
    expect(schemaProblems(cite)).toEqual([]);
    expect(schemaProblems({ ...cite, additionalProperties: true })).toContain('schema: additionalProperties is false');
    expect(schemaProblems({ ...cite, properties: { ...cite.properties, bad: { type: 'string', maxLength: 5, pattern: 'x' } } })).toEqual(['schema.properties.bad: string fields take no pattern']);
    expect(schemaProblems({ ...cite, properties: { ...cite.properties, deep: { type: 'object' } } })[0]).toMatch(/type is string, number/);
    expect(schemaProblems({ ...cite, properties: { ...cite.properties, nested: { type: 'array', maxItems: 2, items: { type: 'array', maxItems: 1, items: { type: 'boolean' } } } } })[0]).toMatch(/array of arrays/);
    expect(schemaProblems({ ...cite, required: ['missing'] })).toContain('schema: required names missing, which is not a property');
  });
  it('validates a return by the paths that fail, with lengths in scalar values', () => {
    expect(returnProblems(cite, { verdict: 'supports', quote: 'a', page: '3' })).toEqual([]);
    expect(returnProblems(cite, { verdict: 'maybe', quote: 'a', page: '3' })).toEqual(['return.verdict: one of supports, partly, contradicts, unreachable']);
    expect(returnProblems(cite, { verdict: 'supports', quote: 'a' })).toEqual(['return.page: required']);
    expect(returnProblems(cite, { verdict: 'supports', quote: 'a', page: '3', extra: 1 })).toEqual(['return.extra: not a field of the schema']);
    expect(scalarLength('👩‍💻x')).toBe(4);
    expect(returnProblems(cite, { verdict: 'supports', quote: 'a', page: '😀'.repeat(20) })).toEqual([]);
    expect(returnProblems(cite, { verdict: 'supports', quote: 'a', page: '😀'.repeat(21) })).toEqual(['return.page: at most 20 characters']);
    expect(returnProblems(cite, { verdict: 'supports', quote: 'a', page: '3', when: '2026-02-30' })).toEqual(['return.when: a date, YYYY-MM-DD']);
    expect(returnProblems(cite, { verdict: 'supports', quote: 'a', page: '3', tags: ['a', 'b', 'c', 'd'] })).toEqual(['return.tags: at most 3 items']);
  });
  it('agrees on the agree fields after canonicalisation, and only on those', () => {
    const fields = agreeFields(cite, ['verdict']);
    expect(fields).toEqual(['verdict']);
    expect(agreeFields(cite, undefined)).toEqual(['verdict', 'quote', 'page']);
    const a = { verdict: 'supports', quote: 'The model was found to', page: '12' };
    const b = { verdict: 'supports', quote: 'a different twenty-five words', page: '13' };
    expect(returnsAgree(cite, ['verdict'], a, b)).toBe(true);
    expect(returnsAgree(cite, ['verdict', 'quote'], a, b)).toBe(false);
    expect(returnsAgree(cite, ['quote'], { ...a, quote: '  The  MODEL was found to ' }, a)).toBe(true);
    expect(returnsAgree(cite, ['score'], { ...a, score: 1.0 }, { ...a, score: 1.4 })).toBe(true);
    expect(returnsAgree(cite, ['score'], { ...a, score: 1.0 }, { ...a, score: 1.6 })).toBe(false);
    expect(returnsAgree(cite, ['when'], { ...a, when: '2026-10-24' }, { ...a, when: '2026-10-24T18:00:00Z' })).toBe(true);
    expect(canonicaliseField({ type: 'string', maxLength: 5 }, 'É ')).toBe('é');
  });
  it('lists every string for the gate', () => {
    expect(returnStrings({ verdict: 'supports', quote: 'q', tags: ['t', 'u'], score: 1 })).toEqual(['supports', 'q', 't', 'u']);
  });
});
