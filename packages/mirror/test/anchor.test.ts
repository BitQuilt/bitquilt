import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OP_SHA256, OTS_HEADER, anchorHeads, anchorsHeld, hexToBytes, otsFile } from '../src/anchor.js';

/**
 * QX-12 at the mirror: a head is stamped through the first calendar that answers, the file is a detached
 * OpenTimestamps proof of the head's digest with the calendar's bytes after it, a head already stamped is kept, and a
 * calendar that fails is passed over.
 */
const head = (problem: string, seq: number, n: number) => ({ problem, seq, hash: n.toString(16).padStart(64, '0') });
const calendarBytes = new Uint8Array([0xf0, 0x10, 0x01, 0x02, 0x03, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);

function fakeFetch(answers: Record<string, 'ok' | 'down' | 'empty'>, calls: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const origin = url.replace(/\/digest$/, '');
    expect(init?.method).toBe('POST');
    expect((init?.body as Uint8Array).length).toBe(32);
    const how = answers[origin] ?? 'down';
    if (how === 'down') return new Response('no', { status: 503 });
    if (how === 'empty') return new Response(new Uint8Array(0), { status: 200 });
    return new Response(calendarBytes, { status: 200 });
  }) as typeof fetch;
}

// As in mirror.test.ts: a chain's folder carries a colon, so this runs where the mirror runs, not on Windows.
describe.skipIf(process.platform === 'win32')('anchoring chain heads (QX-12)', () => {
  it('writes a detached timestamp of the head\'s digest with the calendar\'s answer after it, and a sidecar', async () => {
    const out = mkdtempSync(join(tmpdir(), 'quilt-anchor-'));
    const calls: string[] = [];
    const r = await anchorHeads({ out, heads: [head('sha256:' + 'a'.repeat(64), 7, 0x1234)], calendars: ['https://cal.test'], fetchImpl: fakeFetch({ 'https://cal.test': 'ok' }, calls), now: () => '2026-10-26T20:00:00Z' });
    expect(r.stamped).toEqual([{ problem: 'sha256:' + 'a'.repeat(64), seq: 7, calendar: 'https://cal.test' }]);
    expect(r.failed).toEqual([]);
    const file = join(out, 'anchors', 'sha256:' + 'a'.repeat(64), '7.ots');
    expect(existsSync(file)).toBe(true);
    const bytes = new Uint8Array(readFileSync(file));
    expect([...bytes.slice(0, OTS_HEADER.length)]).toEqual([...OTS_HEADER]);
    expect(bytes[OTS_HEADER.length]).toBe(OP_SHA256);
    expect([...bytes.slice(OTS_HEADER.length + 1, OTS_HEADER.length + 33)]).toEqual([...hexToBytes(head('x', 7, 0x1234).hash)]);
    expect([...bytes.slice(OTS_HEADER.length + 33)]).toEqual([...calendarBytes]);
    const side = JSON.parse(readFileSync(join(out, 'anchors', 'sha256:' + 'a'.repeat(64), '7.json'), 'utf8'));
    expect(side).toEqual({ problem: 'sha256:' + 'a'.repeat(64), seq: 7, hash: head('x', 7, 0x1234).hash, calendar: 'https://cal.test', stamped_at: '2026-10-26T20:00:00Z', attestation: 'pending' });
    expect(anchorsHeld(out, 'sha256:' + 'a'.repeat(64)).map((a) => a.seq)).toEqual([7]);
    // The same head again is kept, with no second call to any calendar.
    const again = await anchorHeads({ out, heads: [head('sha256:' + 'a'.repeat(64), 7, 0x1234)], calendars: ['https://cal.test'], fetchImpl: fakeFetch({}, calls) });
    expect(again.kept).toBe(1);
    expect(again.stamped).toEqual([]);
    expect(calls).toHaveLength(1);
  });
  it('passes over a calendar that is down or answers with nothing, and reports a head no calendar took', async () => {
    const out = mkdtempSync(join(tmpdir(), 'quilt-anchor-'));
    const calls: string[] = [];
    const r = await anchorHeads({ out, heads: [head('identity', 3, 9), head('identity', 4, 10)], calendars: ['https://down.test', 'https://empty.test', 'https://ok.test'], fetchImpl: fakeFetch({ 'https://empty.test': 'empty', 'https://ok.test': 'ok' }, calls) });
    expect(r.stamped.map((s) => s.calendar)).toEqual(['https://ok.test', 'https://ok.test']);
    expect(calls.filter((c) => c.startsWith('https://ok.test'))).toHaveLength(2);
    const none = await anchorHeads({ out, heads: [head('identity', 5, 11)], calendars: ['https://down.test'], fetchImpl: fakeFetch({}, calls) });
    expect(none.failed).toHaveLength(1);
    expect(none.failed[0]!.why).toMatch(/503/);
    expect(existsSync(join(out, 'anchors', 'identity', '5.ots'))).toBe(false);
  });
  it('refuses a head that is not a sha256 hex and a digest that is not 32 bytes', () => {
    expect(() => hexToBytes('abc')).toThrow(/64 hex/);
    expect(() => otsFile(new Uint8Array(31), calendarBytes)).toThrow(/32 bytes/);
  });
});
