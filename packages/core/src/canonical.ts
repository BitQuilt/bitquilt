/**
 * Canonical JSON, RFC 8785 (JSON Canonicalization Scheme): object keys sorted by UTF-16 code units, no whitespace,
 * numbers and strings serialised as ECMAScript's JSON.stringify serialises them. Everything the core hashes or signs
 * is the UTF-8 bytes of this form, so two clients that agree on the value agree on the bytes.
 *
 * Properties whose value is undefined are left out, as JSON.stringify leaves them out. Anything that is not JSON
 * (a function, a symbol, a bigint, NaN, Infinity, a Date) is refused rather than serialised to something surprising.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonical(value: unknown): string {
  const out: string[] = [];
  write(value, out, '$');
  return out.join('');
}

function write(value: unknown, out: string[], path: string): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`${path}: not a finite number`);
      out.push(JSON.stringify(value));
      return;
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'object':
      break;
    default:
      throw new TypeError(`${path}: a ${typeof value} is not JSON`);
  }
  if (Array.isArray(value)) {
    out.push('[');
    value.forEach((item, i) => {
      if (i > 0) out.push(',');
      if (item === undefined) throw new TypeError(`${path}[${i}]: undefined in an array`);
      write(item, out, `${path}[${i}]`);
    });
    out.push(']');
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${path}: not a plain object`);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(compareUtf16);
  out.push('{');
  keys.forEach((k, i) => {
    if (i > 0) out.push(',');
    out.push(JSON.stringify(k), ':');
    write(obj[k], out, `${path}.${k}`);
  });
  out.push('}');
}

/** Sort as JCS asks: by UTF-16 code units, which is what comparing JavaScript strings with < does. */
function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The UTF-8 bytes of the canonical form, which is what is hashed and signed. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonical(value));
}
