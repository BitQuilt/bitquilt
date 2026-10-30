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
 * The answer is then handed back through `quilt return`, signed by this worker's key, declared as `<vendor>/<model>`
 * (set `model` in the key's config, or QUILT_MODEL, to that same value so the claim says what the reveal says).
 *
 * With --second-only the CLI runs with QUILT_NEXT_ONLY=verify: it hands out only a piece another vendor has already
 * returned, so this worker confirms or disagrees with that reading and never does first work. With --all and no
 * problem named, every problem the tracker lists with pieces waiting on a second reading is worked in turn, up to
 * --max pieces in the run; this is the house second opinion (docs/DEPLOY.md). The tracker asked is the first in
 * QUILT_TRACKERS, else the first the CLI's own config names.
 *
 * The CLI is `quilt` on the PATH, or the command in QUILT_BIN; in the repository, `pnpm -s --filter quilt start` works.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SWITCHES = new Set(['--second-only', '--all']);

/** The flags as every worker takes them: the problem and the evidence file by position, the rest named. */
export function parseArgs(args, defaultModel) {
  const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') && !SWITCHES.has(args[i - 1])));
  return { problem: positional[0], evidenceFile: positional[1], model: flag('--model', defaultModel), max: Number(flag('--max', '1000')), secondOnly: args.includes('--second-only'), all: args.includes('--all') };
}

/** The piece as the CLI prints it: its name and hash, the brief, the schema's fields, what is required. */
export function readPiece(text) {
  const head = text.match(/Piece (\S+) \((sha256:[0-9a-f]+)\)/);
  const brief = text.match(/wrote this brief: "([\s\S]*?)"\n/)?.[1];
  const fields = text.match(/these fields: (\{[\s\S]*?\}); required: ([^;]*); agreement is on: ([^.]*)\./);
  if (!head || !brief || !fields) return null;
  return { name: head[1], hash: head[2], brief, properties: JSON.parse(fields[1]), required: fields[2].split(',').map((s) => s.trim()).filter(Boolean) };
}

/** One field of the piece's schema as the model's output schema: an enum as it is, a number, an integer or a boolean by type, a list of one of those, the rest strings. */
function fieldSchema(def) {
  if (def.enum) return { type: 'string', enum: def.enum };
  if (def.type === 'array') return { type: 'array', items: fieldSchema(def.items ?? {}), ...(def.maxItems ? { maxItems: def.maxItems } : {}) };
  return { type: def.type === 'integer' ? 'integer' : def.type === 'number' ? 'number' : def.type === 'boolean' ? 'boolean' : 'string' };
}

/** The JSON schema the answer takes, from the piece's own fields: every field given, nothing else, each in the shape the piece names. */
export function schemaOf(piece) {
  const schema = { type: 'object', additionalProperties: false, required: Object.keys(piece.properties), properties: {} };
  for (const [k, def] of Object.entries(piece.properties)) schema.properties[k] = fieldSchema(def);
  return schema;
}

/** What the model is told it is doing, the same for every vendor; `note` is the second asking, when a quote was not found. */
export function instruction(note) {
  return 'You work one piece of a problem for a person who published it. The author\'s brief says what is wanted; the evidence, when given, is the only source to rely on. Answer in the shape asked for. A quote is copied verbatim from the evidence, at most 25 words, and is the best support for your answer. Every string is plain text as a tracker admits it: no links or web addresses, no markup, no email addresses, phone numbers or handles, nothing addressed to a machine; a source is named by its title and its id, not by its address.' + (note ? ' ' + note : '');
}

/** The one message with the piece in it: the brief as the author's quoted words, the evidence when there is one, else `without`, and the fields wanted. */
export function question(piece, evidence, without = '') {
  return `The author wrote this brief: "${piece.brief}"\n\n${evidence ? `The evidence:\n\n${evidence}\n\n` : without ? `${without}\n\n` : ''}Answer with the fields: ${Object.keys(piece.properties).join(', ')}.`;
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

  /**
   * One problem worked until the CLI hands out nothing more or `budget` pieces are returned: the number returned. A
   * piece the model or the tracker refuses is logged and ends this problem; the run goes on to the next.
   */
  async function work(problem, budget) {
    let n = 0;
    for (; n < budget; n++) {
      let text;
      try { text = quilt('next', problem); } catch (e) {
        const said = (e.stderr || e.message).trim().split('\n').pop();
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
        for (const [k, def] of Object.entries(piece.properties)) if (typeof answer[k] === 'string' && def.maxLength && answer[k].length > def.maxLength) answer[k] = answer[k].slice(0, def.maxLength);
        const r = jsonOut(quilt('return', problem, piece.hash, JSON.stringify(answer)));
        console.log(`${piece.name}: ${JSON.stringify(answer)} -> commit ${r.commit.queued ? 'queued' : 'posted'}, reveal ${r.reveal.queued ? 'queued' : 'posted'}${answer.quote && !quoteOk(answer) ? ' (quote not verbatim)' : ''}`);
      } catch (e) {
        console.log(`${piece.name}: not returned: ${(e.stderr || e.message).trim().split('\n').pop()}`);
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
      if (n >= o.max) break;
      if (i > 0) await pause(2000);
      console.log(`${p.problem.slice(0, 19)} "${p.title}": ${p.waiting} waiting`);
      n += await work(p.problem, o.max - n);
    }
  } else {
    n = await work(o.problem, o.max);
  }
  console.log(`${n} piece${n === 1 ? '' : 's'} returned as ${vendor}/${o.model}${o.secondOnly ? ', each a second reading' : ''}`);
}
