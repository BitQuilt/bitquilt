/**
 * The plain-text gate, `gate/1`: what a tracker applies at its door to briefs, templates, topics and every string in a
 * return, and what a renderer may apply again before showing text to a person or a model. Pure and deterministic; no
 * model is asked. It is admission, not validity: the reducer does not call it (CORE.md, section 11).
 *
 * Public text may not carry links or markup outside typed fields, contact details, shouting, or phrases that try to
 * instruct a model reading it. Before any of that is looked for, what a reader cannot see is taken out: zero-width and
 * direction marks, tag characters, private-use and unassigned code points, variation selectors and controls. One
 * exception, because without it some languages are misspelled and some emoji fall apart: a single joiner between two
 * letters of a script written with joiners, or between two emoji.
 *
 * First written for another project of the maintainers, 24 Oct 2026.
 */

/**
 * Section 11 identifies the gate by the hash of its source; this constant is only its name. `gate/2` (30 October 2026,
 * CORE.md section 12) replaced `gate/1`'s phone rule, which refused honest runs of figures: a bill of mortality's totals, a
 * specimen's barcode, an item number beside a year. A phone number now needs the shape of one.
 */
export const GATE_VERSION = 'gate/2';

/** Phrases that try to instruct a model. Each is an order, not a mention. */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|above|earlier)\b[^.]{0,20}\b(instructions?|prompts?)\b/i,
  /\byou are now (?:a|an|the)\b[^.]{0,30}\b(assistant|model|bot|persona|character)\b/i,
  /(^|\n)\s*#*\s*(system|developer)\s*(prompt|message)\s*:|\b(new|updated|override|real)\s+(system|developer)\s*(prompt|message)\b/i,
  /\b(reveal|disclose|print|output|repeat|show)\b[^.]{0,30}\b(your (?:system prompt|instructions|hidden instructions|rules)|hidden instructions)\b/i,
  /\bDAN mode\b/i,
  /\[\s*(system|inst|\/inst|assistant)\s*\]|<\|.*?\|>|\{\{.*?\}\}/i,
];

const UNSEEN = /[\p{Cf}\p{Co}\p{Cn}\p{Cs}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f︀-️\u{e0100}-\u{e01ef}]/gu;
const JOINED =
  '\\p{Script=Arabic}\\p{Script=Devanagari}\\p{Script=Bengali}\\p{Script=Gurmukhi}\\p{Script=Gujarati}\\p{Script=Oriya}\\p{Script=Tamil}\\p{Script=Telugu}\\p{Script=Kannada}\\p{Script=Malayalam}\\p{Script=Sinhala}';
const BEFORE_JOINER = new RegExp(`(?:[${JOINED}]|\\p{Extended_Pictographic}\\ufe0f?)$`, 'u');
const AFTER_JOINER = new RegExp(`^(?:[${JOINED}]|\\p{Extended_Pictographic})`, 'u');

function joins(ch: string, at: number, all: string): boolean {
  if (ch !== '‌' && ch !== '‍') return false;
  const before = all.slice(Math.max(0, at - 3), at);
  const after = all.slice(at + 1, at + 3);
  const [b] = BEFORE_JOINER.exec(before) ?? [''];
  const [a] = AFTER_JOINER.exec(after) ?? [''];
  if (!a || !b) return false;
  const emoji = (x: string) => /\p{Extended_Pictographic}/u.test(x);
  return emoji(a) === emoji(b) && (emoji(a) ? ch === '‍' : true);
}

/** The text as a reader sees it: NFKC, with everything invisible removed except a joiner doing its ordinary work. */
export function visible(s: string): string {
  return s.normalize('NFKC').replace(UNSEEN, (ch, at: number, all: string) => (joins(ch, at, all) ? ch : ''));
}

const LINK = /https?:|www\.|\b[a-z0-9-]+\.[a-z]{2,24}\/\S|\]\(|\]\[|^\s*\[[^\]]+\]:|<\/?[a-z][^>]*>/im;
const DOMAIN = /\b[a-z0-9-]+\.(com|org|net|io|ai|dev|xyz|gov|edu|app|me|ly|co|gg|to|sh|link|info|biz|page|site|online|uk|de|fr|ru|cn|us)\b/gi;

function linkish(text: string): boolean {
  if (LINK.test(text)) return true;
  for (const m of text.matchAll(DOMAIN)) if (!/^[A-Z][a-z]+$/.test(m[1]!)) return true;
  return false;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
/** A run of digits with the separators a phone number uses, not attached to a letter or another digit: an identifier like K000123456 is not one. */
const PHONE = /(?<![A-Za-z\d])\+?(?:\(\d{2,4}\)|\d)[\d\s().-]{5,}\d/g;
/** Dates, times and a year in brackets, which read as when and not as whom to call. */
const WHEN = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b|\(\s*(?:1\d{3}|20\d{2})\s*\)/g;
/** A word before a run that says it is a number of something, not a telephone. */
const NUMBERED = /\b(?:isbn|issn|doi|pmc|pmid|item|no\.?|number|id|barcode|catalogue|catalog|accession|specimen|page|pp\.?|ref\.?)\s*[:#]?\s*$/i;
const YEAR = /^(?:1\d{3}|20\d{2})$/;

/**
 * Whether the text carries something that reads as a telephone number: seven to fifteen digits in one run, with the
 * shape of one: a leading plus, a bracketed area code, dashes or dots between groups, a single unbroken run, or two to
 * four spaced groups of two to five digits making nine or more. A run of years, a run of figures in more groups than
 * a number has, and a run named as an item, page or catalogue number are not.
 */
function phoneLike(text: string): boolean {
  const cleaned = text.replace(WHEN, ' when ');
  for (const m of cleaned.matchAll(PHONE)) {
    const run = m[0];
    const groups = run.match(/\d+/g) ?? [];
    const digits = groups.join('').length;
    if (digits < 7 || digits > 15) continue;
    if (groups.every((g) => YEAR.test(g))) continue;
    if (NUMBERED.test(cleaned.slice(Math.max(0, m.index! - 14), m.index))) continue;
    const shaped = /^\+/.test(run) || /^\(\d{3}\)/.test(run) || /\d[-.]\d/.test(run) || groups.length === 1;
    const spaced = groups.length >= 2 && groups.length <= 4 && groups.every((g) => g.length >= 2 && g.length <= 5) && digits >= 9;
    if (shaped || spaced) return true;
  }
  return false;
}

const HANDLE = /(^|[^\w])@[\w.]{2,}/;
const ORDER = '(?:ignore|disregard|override|forget|bypass)';
const RULES = '(?:instructions?|prompts?|guidelines|rules|directives|system prompt|programming|training)';
const READER_NAME = '(?:claude|chatgpt|gpt|gemini|copilot|grok|llama)';
const READERS = '(?:ais?|llms?|models?|assistants?|bots?|agents?|everyone)';

const READER_INSTRUCTIONS: RegExp[] = [
  ...INJECTION_PATTERNS,
  new RegExp(`\\b${ORDER}\\s+(?:all\\s+|any\\s+|every\\s+)?(?:of\\s+)?(?:your|all previous|previous|prior|above|earlier)\\b[^.!?]{0,25}\\b${RULES}\\b`, 'i'),
  new RegExp(
    `(?:^|[.!?:;]\\s*|\\b(?:please|ok|okay|hey)\\b[\\s,]*|(?<!\\b(?:do|does|did|would|will|can|could|should|might|may|to|that)\\s)\\b${READER_NAME}\\b\\s*[,:—–-]?\\s*|\\b${READERS}\\s*[,:—–-]\\s*)${ORDER}\\s+(?:all\\s+|any\\s+|every\\s+)?(?:of\\s+)?(?:the|these|those|its|my)?\\s*(?:own\\s+)?(?:safety\\s+)?${RULES}\\b`,
    'i',
  ),
  /\bI (?:want|need) you to (?:ignore|disregard|forget|override)\b/i,
  /\b(if you are|to any|attention,?|note to) (an? )?(AI|LLM|language model|assistant|agent|model)\b[^.]{0,20}\b(reading|parsing|processing|summari[sz]ing)\b/i,
  /\b(you are now|from now on,? you are)\s+(?:\w+\s+){0,3}?(assistant|model|AI|bot|agent|persona|character|mode)\b/i,
  /\b(?:[Yy]ou(?: are|'re|’re) now|[Ff]rom now on,? you(?: are|'re|’re))\s+(?:called\s+|named\s+)?[A-Z][A-Za-z]{1,20}\b/,
  /\b(here are|these are|follow|obey)\s+(?:your\s+|my\s+|the\s+)?new instructions\b|\bnew instructions\s*(:|follow\b|below\b|are as follows\b)|\byour new (?:instructions|rules|task|role|prompt|orders)\b/i,
];

export type TextIssue = 'links' | 'contact' | 'machines' | 'shouting';

/** Whether this reads as something said to a model that is reading it. */
export function addressedToMachines(text: string): boolean {
  return READER_INSTRUCTIONS.some((re) => re.test(text));
}

/** What is wrong with a piece of public text, as short codes. Empty when clean. The text is made visible first. */
export function textIssues(raw: string): TextIssue[] {
  const text = visible(raw);
  const out: TextIssue[] = [];
  if (linkish(text)) out.push('links');
  if (EMAIL.test(text) || phoneLike(text) || HANDLE.test(text)) out.push('contact');
  if (addressedToMachines(text)) out.push('machines');
  if (/[A-Z]{12,}/.test(text.replace(/\s/g, ''))) out.push('shouting');
  return out;
}

const ISSUE_TEXT: Record<TextIssue, string> = {
  links: 'no links or markup',
  contact: 'no contact details',
  machines: 'no instructions to other machines',
  shouting: 'no shouting',
};

/** The issues as sentences a person can read, each prefixed with the field's label. Empty when clean. */
export function plainTextProblems(text: string, label = 'text'): string[] {
  return textIssues(text).map((i) => `${label}: ${ISSUE_TEXT[i]}`);
}
