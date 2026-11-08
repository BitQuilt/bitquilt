/**
 * What the door answers with (http.ts; PROTOCOL.md, The tracker): the JSON writer puts the status, a JSON content type
 * in UTF-8 and any origin first, the headers a caller adds after them, and the body as JSON; a refusal carries its
 * status and its one sentence. The writer is declared once: the tracker, the hosted on-ramp and its authorization
 * server import it and keep no copy of their own.
 */
import { readFileSync, readdirSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Refusal, json } from '../src/http.js';

/** A response that keeps what was written to it. */
function recorded(): { res: ServerResponse; status?: number; headers?: Record<string, string>; body?: string } {
  const out: { res: ServerResponse; status?: number; headers?: Record<string, string>; body?: string } = {
    res: {
      writeHead: (status: number, headers: Record<string, string>) => {
        out.status = status;
        out.headers = headers;
      },
      end: (body: string) => {
        out.body = body;
      },
    } as unknown as ServerResponse,
  };
  return out;
}

describe('the JSON writer', () => {
  it('writes the status, the content type, any origin, and the body as JSON', () => {
    const r = recorded();
    json(r.res, 202, { id: 'x', seq: 1 });
    expect(r.status).toBe(202);
    expect(r.headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    expect(r.body).toBe('{"id":"x","seq":1}');
  });

  it('adds the headers a caller gives after its own', () => {
    const r = recorded();
    json(r.res, 200, { ok: true }, { 'cache-control': 'no-store' });
    expect(Object.entries(r.headers!)).toEqual([
      ['content-type', 'application/json; charset=utf-8'],
      ['access-control-allow-origin', '*'],
      ['cache-control', 'no-store'],
    ]);
  });
});

describe('a refusal', () => {
  it('is an error with a status and one sentence', () => {
    const r = new Refusal(410, 'this problem is taken down here');
    expect(r).toBeInstanceOf(Error);
    expect(r.status).toBe(410);
    expect(r.message).toBe('this problem is taken down here');
  });
});

describe('one writer', () => {
  const src = (pkg: string): string[] => {
    const dir = join(import.meta.dirname, '..', '..', pkg, 'src');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f));
  };

  it('is declared in http.ts alone among the tracker and the hosted on-ramp', () => {
    const declaring = [...src('tracker'), ...src('hosted')]
      .filter((f) => /\bfunction json\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(f.indexOf('packages')));
    expect(declaring.map((f) => f.replaceAll('\\', '/'))).toEqual(['packages/tracker/src/http.ts']);
  });

  it('is what the tracker, the on-ramp and its authorization server import', () => {
    const read = (pkg: string, file: string): string =>
      readFileSync(join(import.meta.dirname, '..', '..', pkg, 'src', file), 'utf8');
    expect(read('tracker', 'tracker.ts')).toMatch(/import \{[^}]*\bjson\b[^}]*\} from '\.\/http\.js';/);
    expect(read('hosted', 'hosted.ts')).toMatch(/import \{[^}]*\bjson\b[^}]*\} from '@bitquilt\/tracker';/);
    expect(read('hosted', 'oauth.ts')).toMatch(/import \{[^}]*\bjson\b[^}]*\} from '@bitquilt\/tracker';/);
  });
});
