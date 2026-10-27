import { describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import { makeLink, parseLink } from '../src/link.js';
import { modelFor } from '../src/quilt.js';

/**
 * The link forms (CORE.md section 8): a bare hash, `quilt:` with a hash or with an owner and a slug and the tracker
 * and mirror hints, and a tracker's own address; the link made from a hash with its hints; and the model a host's
 * name declares, or the override.
 */
const H = ('sha256:' + 'ab'.repeat(32)) as Hash;

describe('links', () => {
  it('parses the three forms and a bare hash', () => {
    expect(parseLink(H)).toEqual({ hash: H, trackers: [], mirrors: [] });
    expect(parseLink(`quilt:${H}?dn=report&tr=https://a.example&tr=https://b.example/&mr=https://m.example/`)).toEqual({ hash: H, name: 'report', trackers: ['https://a.example/', 'https://b.example/'], mirrors: ['https://m.example/'] });
    expect(parseLink('quilt:0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf/report?tr=https://a.example/')).toEqual({ owner: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf', slug: 'report', trackers: ['https://a.example/'], mirrors: [] });
    expect(parseLink(`https://a.example/p/${H}`)).toEqual({ hash: H, trackers: ['https://a.example/'], mirrors: [] });
    expect(() => parseLink('quilt:nonsense')).toThrow(/not a quilt link/);
    expect(() => parseLink('hello')).toThrow(/not a quilt link/);
  });
  it('makes a link with hints', () => {
    expect(makeLink(H, ['https://a.example/'], 'report')).toBe(`quilt:${H}?dn=report&tr=https%3A%2F%2Fa.example%2F`);
    expect(parseLink(makeLink(H, ['https://a.example/'], 'report')).trackers).toEqual(['https://a.example/']);
  });
  it('declares a model from the host, or the override', () => {
    expect(modelFor('Claude Code')).toBe('anthropic/claude-code');
    expect(modelFor('claude-ai')).toBe('anthropic/claude-ai');
    expect(modelFor('ChatGPT Desktop')).toBe('openai/chatgpt-desktop');
    expect(modelFor(undefined)).toBe('unknown/unknown');
    expect(modelFor('anything', 'human')).toBe('human');
  });
});
