/**
 * The closed schema subset of CORE.md section 2, the validation of a return against it, and the canonicalisation and
 * agreement of `agree` fields (section 6). Nothing here is JSON Schema in general: a flat object of strings, numbers,
 * booleans, enums and arrays of those, with lengths in Unicode scalar values and tolerances absolute, and no other
 * keyword, so that two clients cannot read one schema two ways.
 */
export type StringField = { type: 'string'; maxLength: number; minLength?: number; format?: 'date' };
export type NumberField = { type: 'number' | 'integer'; tolerance?: number };
export type BooleanField = { type: 'boolean' };
export type EnumField = { enum: string[] };
export type ScalarField = StringField | NumberField | BooleanField | EnumField;
export type ArrayField = { type: 'array'; maxItems: number; items: ScalarField };
export type Field = ScalarField | ArrayField;

export interface Schema {
  type: 'object';
  additionalProperties: false;
  required: string[];
  properties: Record<string, Field>;
}

export type Return = Record<string, unknown>;

export function isArrayField(f: Field): f is ArrayField {
  return 'type' in f && f.type === 'array';
}

const SCHEMA_KEYS = new Set(['type', 'additionalProperties', 'required', 'properties']);
const STRING_KEYS = new Set(['type', 'maxLength', 'minLength', 'format']);
const NUMBER_KEYS = new Set(['type', 'tolerance']);
const BOOLEAN_KEYS = new Set(['type']);
const ENUM_KEYS = new Set(['enum']);
const ARRAY_KEYS = new Set(['type', 'maxItems', 'items']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extraKeys(o: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(o).filter((k) => !allowed.has(k));
}

/** Why a value is not a field of the subset, or nothing. */
function fieldProblems(f: unknown, at: string, allowArray: boolean): string[] {
  if (!isRecord(f)) return [`${at}: not an object`];
  if ('enum' in f) {
    const extra = extraKeys(f, ENUM_KEYS);
    if (extra.length) return [`${at}: enum fields take no ${extra.join(', ')}`];
    if (!Array.isArray(f.enum) || f.enum.length === 0 || !f.enum.every((x) => typeof x === 'string')) return [`${at}: enum is a non-empty list of strings`];
    if (new Set(f.enum).size !== f.enum.length) return [`${at}: enum repeats a value`];
    return [];
  }
  switch (f.type) {
    case 'string': {
      const extra = extraKeys(f, STRING_KEYS);
      if (extra.length) return [`${at}: string fields take no ${extra.join(', ')}`];
      if (!Number.isInteger(f.maxLength) || (f.maxLength as number) < 1) return [`${at}: maxLength is a whole number from 1`];
      if (f.minLength !== undefined && (!Number.isInteger(f.minLength) || (f.minLength as number) < 0 || (f.minLength as number) > (f.maxLength as number))) return [`${at}: minLength is a whole number up to maxLength`];
      if (f.format !== undefined && f.format !== 'date') return [`${at}: the only format is date`];
      return [];
    }
    case 'number':
    case 'integer': {
      const extra = extraKeys(f, NUMBER_KEYS);
      if (extra.length) return [`${at}: number fields take no ${extra.join(', ')}`];
      if (f.tolerance !== undefined && (typeof f.tolerance !== 'number' || !(f.tolerance >= 0) || !Number.isFinite(f.tolerance))) return [`${at}: tolerance is a finite number of at least 0`];
      return [];
    }
    case 'boolean': {
      const extra = extraKeys(f, BOOLEAN_KEYS);
      return extra.length ? [`${at}: boolean fields take no ${extra.join(', ')}`] : [];
    }
    case 'array': {
      if (!allowArray) return [`${at}: an array of arrays is outside the subset`];
      const extra = extraKeys(f, ARRAY_KEYS);
      if (extra.length) return [`${at}: array fields take no ${extra.join(', ')}`];
      if (!Number.isInteger(f.maxItems) || (f.maxItems as number) < 1) return [`${at}: maxItems is a whole number from 1`];
      return fieldProblems(f.items, `${at}.items`, false);
    }
    default:
      return [`${at}: type is string, number, integer, boolean or array, or the field is an enum`];
  }
}

/** Why this is not a schema of the subset, or nothing. */
export function schemaProblems(s: unknown): string[] {
  if (!isRecord(s)) return ['schema: not an object'];
  const extra = extraKeys(s, SCHEMA_KEYS);
  if (extra.length) return [`schema: takes no ${extra.join(', ')}`];
  const out: string[] = [];
  if (s.type !== 'object') out.push('schema: type is object');
  if (s.additionalProperties !== false) out.push('schema: additionalProperties is false');
  if (!isRecord(s.properties)) return [...out, 'schema: properties is an object'];
  const names = Object.keys(s.properties);
  if (names.length === 0) out.push('schema: at least one property');
  for (const name of names) out.push(...fieldProblems(s.properties[name], `schema.properties.${name}`, true));
  if (!Array.isArray(s.required) || !s.required.every((r) => typeof r === 'string')) out.push('schema: required is a list of names');
  else for (const r of s.required) if (!(r in s.properties)) out.push(`schema: required names ${r}, which is not a property`);
  return out;
}

/** The length of a string in Unicode scalar values, which is what the subset's lengths count. */
export function scalarLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** A date field's value as the day it names, or null when it is not a date. */
export function parseDay(s: string): string | null {
  const m = DAY.exec(s);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const iso = new Date(t).toISOString().slice(0, 10);
  return iso === `${m[1]}-${m[2]}-${m[3]}` ? iso : null;
}

function scalarProblems(f: ScalarField, v: unknown, at: string): string[] {
  if ('enum' in f) return typeof v === 'string' && f.enum.includes(v) ? [] : [`${at}: one of ${f.enum.join(', ')}`];
  switch (f.type) {
    case 'string': {
      if (typeof v !== 'string') return [`${at}: a string`];
      const len = scalarLength(v);
      if (len > f.maxLength) return [`${at}: at most ${f.maxLength} characters`];
      if (f.minLength !== undefined && len < f.minLength) return [`${at}: at least ${f.minLength} characters`];
      if (f.format === 'date' && parseDay(v) === null) return [`${at}: a date, YYYY-MM-DD`];
      return [];
    }
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? [] : [`${at}: a number`];
    case 'integer':
      return Number.isInteger(v) ? [] : [`${at}: a whole number`];
    case 'boolean':
      return typeof v === 'boolean' ? [] : [`${at}: true or false`];
  }
}

/** Why this return does not fit the schema, as the paths that fail, or nothing. */
export function returnProblems(schema: Schema, value: unknown): string[] {
  if (!isRecord(value)) return ['return: not an object'];
  const out: string[] = [];
  for (const k of Object.keys(value)) if (!(k in schema.properties)) out.push(`return.${k}: not a field of the schema`);
  for (const r of schema.required) if (!(r in value)) out.push(`return.${r}: required`);
  for (const [name, f] of Object.entries(schema.properties)) {
    if (!(name in value)) continue;
    const v = value[name];
    const at = `return.${name}`;
    if (isArrayField(f)) {
      if (!Array.isArray(v)) {
        out.push(`${at}: a list`);
        continue;
      }
      if (v.length > f.maxItems) out.push(`${at}: at most ${f.maxItems} items`);
      v.forEach((item, i) => out.push(...scalarProblems(f.items, item, `${at}[${i}]`)));
    } else {
      out.push(...scalarProblems(f, v, at));
    }
  }
  return out;
}

/** Every string in a return, for the gate at a tracker's door. */
export function returnStrings(value: Return): string[] {
  const out: string[] = [];
  for (const v of Object.values(value)) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  }
  return out;
}

/** A field's value folded as section 6 says, so that two honest returns compare as one. */
export function canonicaliseField(f: Field, v: unknown): unknown {
  if (isArrayField(f)) return Array.isArray(v) ? v.map((x) => canonicaliseField(f.items, x)) : v;
  if ('enum' in f) return v;
  if (f.type === 'string' && typeof v === 'string') {
    if (f.format === 'date') return parseDay(v) ?? v;
    return v.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  return v;
}

function scalarsAgree(f: ScalarField, a: unknown, b: unknown): boolean {
  if ('enum' in f) return a === b;
  if (f.type === 'number' || f.type === 'integer') {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    return f.tolerance !== undefined ? Math.abs(a - b) <= f.tolerance : a === b;
  }
  return canonicaliseField(f, a) === canonicaliseField(f, b);
}

function fieldAgrees(f: Field, a: unknown, b: unknown): boolean {
  if (isArrayField(f)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => scalarsAgree(f.items, x, b[i]));
  }
  return scalarsAgree(f, a, b);
}

/** The fields agreement is computed on: the piece's `agree`, or every required field when it names none. */
export function agreeFields(schema: Schema, agree: string[] | undefined): string[] {
  return agree && agree.length ? agree : schema.required;
}

/** Whether two valid returns agree on the agree fields. */
export function returnsAgree(schema: Schema, fields: string[], a: Return, b: Return): boolean {
  return fields.every((name) => {
    const f = schema.properties[name];
    return f !== undefined && fieldAgrees(f, a[name], b[name]);
  });
}
