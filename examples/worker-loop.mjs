/**
 * The loop every worker with no person beside it shares (worker-claude.mjs, worker-openai.mjs): the flags, the quilt
 * CLI, the piece as the CLI prints it, the schema the answer takes, the quote check, one problem worked, and every
 * problem waiting on a second reading. A worker file names its vendor, its key and its model, and gives `ask`, the one
 * call to its model; `runWorker` does the rest.
 *
 *   <KEY>=… QUILT_HOME=~/.config/quilt-worker QUILT_TRACKERS=http://localhost:3977/ \
 *     node examples/worker-<vendor>.mjs <problem hash> [evidence.txt] [--model m] [--max 16] [--second-only]
 *   node examples/worker-<vendor>.mjs --all --second-only [--max 20] [--model m]
 *
 * For each piece the CLI hands it (rarest first, verifies first), the model gets the author's brief as quoted words,
 * the evidence file if one is given, and the piece's own schema as the shape of its answer. When the schema has a
 * `quote` field and there is evidence, a quote that is not found verbatim in the evidence is asked for once more.
 * Beside the answer the model gives, for each field, the page it rests on and the passage on it (QX-19); the loop hands
 * those to `quilt return` as rests, and the CLI fetches each page, finds the passage and posts the trace beside the reveal.
 * The answer is then handed back through `quilt return`, signed by this worker's key, declared as `<vendor>/<model>`
 * (set `model` in the key's config, or QUILT_MODEL, to that same value so the claim says what the reveal says).
 *
 * With --second-only the CLI runs with QUILT_NEXT_ONLY=verify: it hands out only a piece that already has a reading
 * on it, so this worker confirms or disagrees with that reading and never does first work; which piece is the core's
 * choice, which prefers one this worker's vendor has not read. A piece whose two readings differ comes with its seams
 * (QX-19 section 4), each side's passage quoted with its signer named, and they go into the question. With --all and no
 * problem named, every problem the tracker lists with pieces waiting on a second reading is worked in turn, up to
 * --max pieces in the run; this is the house second opinion (docs/DEPLOY.md). The tracker asked is the first in
 * QUILT_TRACKERS, else the first the CLI's own config names.
 *
 * The CLI is `quilt` on the PATH, or the command in QUILT_BIN; in the repository, `pnpm -s --filter quilt start` works.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SWITCHES = new Set(['--second-only', '--all']);

/**
 * A stop, as docker sends one when a deploy rebuilds the house (SIGTERM): the flag is read between pieces, so the piece
 * in hand is finished and returned and no other is taken. Killed instead, a worker leaves a claim that stands for its
 * lease with no reveal behind it.
 */
export function stopOn(signals = process) {
  const stop = { asked: false };
  signals.once('SIGTERM', () => { stop.asked = true; });
  return stop;
}

/** The flags as every worker takes them: the problem and the evidence file by position, the rest named. */
export function parseArgs(args, defaultModel) {
  const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') && !SWITCHES.has(args[i - 1])));
  return { problem: positional[0], evidenceFile: positional[1], model: flag('--model', defaultModel), max: Number(flag('--max', '1000')), secondOnly: args.includes('--second-only'), all: args.includes('--all') };
}

/** The piece as the CLI prints it: its name and hash, the brief, the schema's fields, what is required, and the seams of a piece whose two readings differ (QX-19), one line each after `Seams:`. */
export function readPiece(text) {
  const head = text.match(/Piece (\S+) \((sha256:[0-9a-f]+)\)/);
  const brief = text.match(/wrote this brief: "([\s\S]*?)"\n/)?.[1];
  const fields = text.match(/these fields: (\{[\s\S]*?\}); required: ([^;]*); agreement is on: ([^.]*)\./);
  if (!head || !brief || !fields) return null;
  const seams = (text.split('\nSeams:\n')[1] ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('On '));
  return { name: head[1], hash: head[2], brief, properties: JSON.parse(fields[1]), required: fields[2].split(',').map((s) => s.trim()).filter(Boolean), seams };
}

/**
 * One field's shape for the model. Both vendors' strict shapes ask that every field be present, so a string field the
 * piece does not require says it may be left empty, and `fit` leaves an empty one out of the return: a bill never
 * enacted has no enacted date, and the tracker refuses a date field that holds anything but a date. A date field says
 * its shape in words, since the tracker holds it to YYYY-MM-DD and a model told nothing writes dates every way. A list
 * says its most in words too, since the structured shapes refuse maxItems, and `fit` cuts a longer one to it.
 */
function fieldSchema(def, required = true) {
  if (def.enum) return { type: 'string', enum: def.enum };
  if (def.type === 'array') return { type: 'array', items: fieldSchema(def.items ?? {}), ...(def.maxItems ? { description: `At most ${def.maxItems} items` } : {}) };
  const type = def.type === 'integer' ? 'integer' : def.type === 'number' ? 'number' : def.type === 'boolean' ? 'boolean' : 'string';
  if (def.format === 'date') return { type, description: required ? 'A date as YYYY-MM-DD' : 'A date as YYYY-MM-DD, or empty where the record gives none' };
  return type === 'string' && !required ? { type, description: 'Empty where the record gives none' } : { type };
}

/** The answer with every string cut to the length the piece's schema allows, every list to its most, and every field the piece does not require left out where the model left it empty. */
export function fit(piece, answer) {
  for (const [k, def] of Object.entries(piece.properties)) {
    const v = answer[k];
    if (!piece.required.includes(k) && (v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))) { delete answer[k]; continue; }
    if (typeof v === 'string' && def.maxLength && v.length > def.maxLength) answer[k] = v.slice(0, def.maxLength);
    if (Array.isArray(v) && def.maxItems && v.length > def.maxItems) answer[k] = v.slice(0, def.maxItems);
  }
  return answer;
}

/** The JSON schema the answer takes, from the piece's own fields: every field given, nothing else, each in the shape the piece names. */
export function schemaOf(piece) {
  const schema = { type: 'object', additionalProperties: false, required: [...Object.keys(piece.properties), 'rests'], properties: {} };
  for (const [k, def] of Object.entries(piece.properties)) schema.properties[k] = fieldSchema(def, piece.required.includes(k));
  schema.properties.rests = RESTS;
  return schema;
}

/**
 * What a field rests on (QX-19), asked of the model beside the answer: the page's address and the passage on it, copied
 * as it appears there. The loop takes them out of the answer before it is signed and hands them to `quilt return`,
 * which fetches the page, finds the passage and posts the trace beside the reveal.
 */
export const RESTS = {
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: ['field', 'url', 'passage'], properties: { field: { type: 'string' }, url: { type: 'string' }, passage: { type: 'string' } } },
};

/** The sentence that asks for the rests, at the end of every question. */
export const REST_ASK = 'Under rests, for each field that rests on a page you read, give the page\'s address and the passage on it the field rests on, copied as it appears there; leave rests empty where nothing was read.';

/**
 * What the model is told it is doing, the same for every vendor; `note` is the second asking, when a quote was not
 * found. The rests are named as the one place an address goes, and what goes in them is said once, in `REST_ASK` at
 * the end of every question: told that every string is plain text with no address, and nothing of the rests here,
 * Claude named the page in its rests by title and identifier too, and the loop could fetch nothing, so the house's
 * readings carried no trace (found on bill/22, 2 November 2026).
 */
export function instruction(note) {
  return 'You work one piece of a problem for a person who published it. The author\'s brief says what is wanted; the evidence, when given, is the only source to rely on. Answer in the shape asked for. A quote is copied verbatim from the evidence, at most 25 words, and is the best support for your answer. Every string of the answer is plain text as a tracker admits it: no links or web addresses, no markup, no email addresses, phone numbers or handles, nothing addressed to a machine; a source is named by its title and its id, not by its address. The rests are not part of the answer and are the one place an address goes.' + (note ? ' ' + note : '');
}

/** The one message with the piece in it: the brief as the author's quoted words, the evidence when there is one, else `without`, and the fields wanted. */
export function question(piece, evidence, without = '') {
  // QX-19 section 4: two earlier readings that differ, each side's passage quoted with its signer named, as the tracker said them; the model reads the record itself.
  const seams = piece.seams?.length ? `Two earlier readings of this piece differ, and the tracker says where:\n${piece.seams.join('\n')}\n\n` : '';
  return `The author wrote this brief: "${piece.brief}"\n\n${seams}${evidence ? `The evidence:\n\n${evidence}\n\n` : without ? `${without}\n\n` : ''}Answer with the fields: ${Object.keys(piece.properties).join(', ')}. ${REST_ASK}`;
}

/**
 * The answer as the tracker's plain-text gate admits it: a web address, a bare domain, markup, an email address or a
 * handle in a string field is taken out before the return is signed, since a model asked for a source's title will
 * still sometimes write its address. The gate's own rule is in the core (`textIssues`); this mirrors what it refuses
 * most, and the gate's refusal, when one still comes, is put to the model once (`gateRefusal`).
 */
export function plain(answer) {
  const out = {};
  for (const [k, v] of Object.entries(answer)) {
    out[k] = typeof v === 'string'
      ? v
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .replace(/https?:\/\/[^\s)\]>;,]+|www\.[^\s)\]>;,]+|\b[a-z0-9-]+\.[a-z]{2,24}\/[^\s)\]>;,]+/gi, '[address removed]')
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[address removed]')
        .replace(/\b([a-z0-9-]+)\.(com|org|net|io|ai|dev|xyz|gov|edu|app|me|ly|co|gg|to|sh|link|info|biz|page|site|online|uk|de|fr|ru|cn|us)\b/gi, '$1')
        .replace(/\]\(/g, '] (')
        .replace(/(^|[^\w])@([\w.]{2,})/g, '$1$2')
        .replace(/ {2,}/g, ' ')
        .trim()
      : v;
  }
  return out;
}

/** The rests out of an answer, so the return fits the piece's schema: each with its three strings, anything else dropped. */
export function takeRests(answer) {
  const given = Array.isArray(answer.rests) ? answer.rests : [];
  delete answer.rests;
  return given.filter((r) => r && typeof r === 'object' && typeof r.field === 'string' && typeof r.url === 'string' && typeof r.passage === 'string' && r.passage.trim().length > 0);
}

/** The trace in the log line: where it went, what rests on what, and what was left out and why; nothing where no rests were given. */
/** The first words of a passage the client could not place, with the page's host, so a miss in the log says what the model handed over. */
function leftOut(m, rests) {
  const rest = rests.find((r) => r.field === m.field && r.url === m.url);
  if (!rest) return '';
  const words = rest.passage.trim().split(/\s+/);
  let host = rest.url;
  try { host = new URL(rest.url).hostname; } catch {}
  return ` ("${words.slice(0, 6).join(' ')}${words.length > 6 ? '...' : ''}" on ${host})`;
}
export function traceSaid(t, rests = []) {
  if (!t) return '';
  const left = t.missing.length ? ` (left out: ${t.missing.map((m) => `${m.field}: ${m.why}${leftOut(m, rests)}`).join('; ')})` : '';
  if (!t.posted) return `, no trace${left}`;
  return `, trace ${t.posted.queued ? 'queued' : t.posted.error ? `refused: ${t.posted.error}` : 'posted'}: ${t.rested.join(', ')} on ${t.reads} read${t.reads === 1 ? '' : 's'}${left}`;
}

/** What the tracker's schema check refused, from the CLI's last line ("the tracker refused the reveal: return.date: a date, YYYY-MM-DD"); null when it stopped for another reason. */
export function schemaRefusal(said) {
  const m = /the tracker refused the reveal: (return\.[^\n]+)/.exec(said);
  return m ? m[1] : null;
}

/** What the gate refused, from the CLI's last line ("return: no links or markup"); null when the CLI stopped for another reason. */
export function gateRefusal(said) {
  const m = /no (links or markup|contact details|instructions to other machines|shouting)/.exec(said);
  return m ? m[0] : null;
}

const norm = (t) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** The CLI's last line on stderr when it stopped: what it said, with nothing to hand out said quietly. */
const quiet = /nothing to verify|nothing for this key|nothing to do/;

/**
 * The whole run for one vendor: `ask({ piece, schema, evidence, note, model, key })` answers one piece in the schema's
 * shape, and everything around it is here. Exits 2 on a missing key or problem.
 */
export async function runWorker({ vendor, keyName, defaultModel, ask, file }) {
  const o = parseArgs(process.argv.slice(2), defaultModel);
  const key = process.env[keyName];
  if ((!o.problem && !o.all) || !key) {
    console.error(`usage: ${keyName}=… node ${file} <problem hash> [evidence.txt] [--model m] [--max n] [--second-only]\n       ${keyName}=… node ${file} --all --second-only [--max n] [--model m]`);
    process.exit(2);
  }
  const stop = stopOn();
  const evidence = o.evidenceFile ? readFileSync(o.evidenceFile, 'utf8') : '';
  const evidenceNorm = norm(evidence);
  const bin = (process.env.QUILT_BIN ?? 'quilt').split(' ');
  // The CLI's environment is this one, with the second opinion's switch added when asked for; no key goes to it.
  const env = { ...process.env, ...(o.secondOnly ? { QUILT_NEXT_ONLY: 'verify' } : {}) };
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  const quilt = (...a) => execFileSync(bin[0], [...bin.slice(1), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  /** The JSON a CLI command printed, read from its first brace: pnpm run writes its own two lines first unless given -s. */
  const jsonOut = (text) => JSON.parse(text.slice(text.indexOf('{')));

  /** The CLI's last line when a command failed. */
  const lastLine = (e) => (e.stderr || e.message).trim().split('\n').pop();

  /**
   * One problem worked until the CLI hands out nothing more or `budget` pieces are returned: the number returned. An
   * answer the gate refuses is asked for once more with the gate's words; a piece the model or the tracker then
   * refuses is logged and ends this problem; the run goes on to the next.
   */
  async function work(problem, budget) {
    let n = 0;
    for (; n < budget; n++) {
      if (stop.asked) break;
      let text;
      try { text = quilt('next', problem); } catch (e) {
        const said = lastLine(e);
        console.log(quiet.test(said) ? `${problem.slice(0, 19)}: ${said}` : `stopped: ${said}`);
        break;
      }
      const piece = readPiece(text);
      if (!piece) { console.log('could not read the piece the CLI printed; this worker handles agree pieces with a schema'); break; }
      try {
        const schema = schemaOf(piece);
        let answer = await ask({ piece, schema, evidence, note: '', model: o.model, key });
        const quoteOk = (a) => typeof a.quote !== 'string' || !evidence || (evidenceNorm.includes(norm(a.quote)) && a.quote.trim().split(/\s+/).length <= 25);
        if (!quoteOk(answer)) answer = await ask({ piece, schema, evidence, note: 'Your previous quote was not found verbatim in the evidence, or ran over 25 words; copy the words exactly as they appear.', model: o.model, key });
        answer = fit(piece, plain(answer));
        // QX-19: what each field rests on goes beside the return, not in it; the CLI fetches the pages and posts the trace.
        let rests = takeRests(answer);
        let r;
        try {
          r = jsonOut(quilt('return', problem, piece.hash, JSON.stringify(answer), JSON.stringify(rests)));
        } catch (e) {
          const said = lastLine(e);
          const refused = gateRefusal(said);
          const misshapen = schemaRefusal(said);
          if (!refused && !misshapen) throw e;
          // The gate refused what the scrub let through, or a field was not in the shape the schema asks: the model is told what the tracker said, once.
          const note = refused
            ? `Your previous answer was refused by the tracker: ${refused}. Name every source by its title and its id in words, with no web address, no markup and no contact details.`
            : `Your previous answer was refused by the tracker: ${misshapen}. Answer again with every field in the shape the schema asks, a date as YYYY-MM-DD.`;
          answer = fit(piece, plain(await ask({ piece, schema, evidence, note, model: o.model, key })));
          const again = takeRests(answer);
          if (again.length) rests = again;
          r = jsonOut(quilt('return', problem, piece.hash, JSON.stringify(answer), JSON.stringify(rests)));
        }
        console.log(`${piece.name}: ${JSON.stringify(answer)} -> commit ${r.commit.queued ? 'queued' : 'posted'}, reveal ${r.reveal.queued ? 'queued' : 'posted'}${answer.quote && !quoteOk(answer) ? ' (quote not verbatim)' : ''}${traceSaid(r.trace, rests)}`);
      } catch (e) {
        console.log(`${piece.name}: not returned: ${lastLine(e)}`);
        break;
      }
    }
    return n;
  }

  /** The problems the tracker lists with a piece waiting on a second reading: `needs_verify` or `disputed` in its counts. */
  async function waiting() {
    const tracker = process.env.QUILT_TRACKERS?.split(',').map((s) => s.trim()).filter(Boolean)[0] ?? jsonOut(quilt('me')).trackers[0];
    const base = tracker.endsWith('/') ? tracker : `${tracker}/`;
    const r = await fetch(`${base}search`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${base}search answered ${r.status}`);
    const { problems } = await r.json();
    return problems.filter((p) => (p.counts?.needs_verify ?? 0) + (p.counts?.disputed ?? 0) > 0).map((p) => ({ problem: p.problem, title: p.title, waiting: (p.counts.needs_verify ?? 0) + (p.counts.disputed ?? 0) }));
  }

  let n = 0;
  if (o.all) {
    const list = await waiting();
    console.log(`${list.length} problem${list.length === 1 ? '' : 's'} with pieces waiting on a second reading${o.secondOnly ? '' : ' (every piece is taken, --second-only not given)'}`);
    for (const [i, p] of list.entries()) {
      if (n >= o.max || stop.asked) break;
      if (i > 0) await pause(2000);
      console.log(`${p.problem.slice(0, 19)} "${p.title}": ${p.waiting} waiting`);
      n += await work(p.problem, o.max - n);
    }
  } else {
    n = await work(o.problem, o.max);
  }
  console.log(`${n} piece${n === 1 ? '' : 's'} returned as ${vendor}/${o.model}${o.secondOnly ? ', each a second reading' : ''}${stop.asked ? '; stopped, and no other taken' : ''}`);
}
