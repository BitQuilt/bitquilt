#!/usr/bin/env node
/**
 * A worker with no person beside it: an OpenAI model works the agree pieces of one problem through the quilt CLI.
 *
 *   OPENAI_API_KEY=… QUILT_HOME=~/.config/quilt-worker QUILT_TRACKERS=http://localhost:3977/ \
 *     node examples/worker-openai.mjs <problem hash> [evidence.txt] [--model gpt-6-luna] [--max 16] [--second-only]
 *   node examples/worker-openai.mjs --all --second-only [--max 20] [--model m]
 *
 * For each piece the CLI hands it (rarest first, verifies first), the model gets the author's brief as quoted words,
 * the evidence file if one is given, and the piece's own schema as the shape of its answer. When the schema has a
 * `quote` field and there is evidence, a quote that is not found verbatim in the evidence is asked for once more.
 * The answer is then handed back through `quilt return`, signed by this worker's key, declared as `openai/<model>`
 * (set `model` in the key's config, or QUILT_MODEL, to that same value so the claim says what the reveal says).
 *
 * With --second-only the CLI runs with QUILT_NEXT_ONLY=verify: it hands out only a piece another vendor has already
 * returned, so this worker confirms or disagrees with that reading and never does first work. With --all and no
 * problem named, every problem the tracker lists with pieces waiting on a second reading is worked in turn, up to
 * --max pieces in the run; this is the house second opinion (docs/DEPLOY.md). The tracker asked is the first in
 * QUILT_TRACKERS, else the first the CLI's own config names.
 *
 * The CLI is `quilt` on the PATH, or the command in QUILT_BIN; in the repository, `pnpm --filter quilt start` works.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const SWITCHES = new Set(['--second-only', '--all']);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') && !SWITCHES.has(args[i - 1])));
const PROBLEM = positional[0];
const EVIDENCE = positional[1] ? readFileSync(positional[1], 'utf8') : '';
const MODEL = flag('--model', 'gpt-6-luna');
const MAX = Number(flag('--max', '1000'));
const SECOND_ONLY = args.includes('--second-only');
const ALL = args.includes('--all');
const KEY = process.env.OPENAI_API_KEY;
if ((!PROBLEM && !ALL) || !KEY) {
  console.error('usage: OPENAI_API_KEY=… node examples/worker-openai.mjs <problem hash> [evidence.txt] [--model m] [--max n] [--second-only]\n       OPENAI_API_KEY=… node examples/worker-openai.mjs --all --second-only [--max n] [--model m]');
  process.exit(2);
}
const bin = (process.env.QUILT_BIN ?? 'quilt').split(' ');
// The CLI's environment is this one, with the second opinion's switch added when asked for; the key never goes to it.
const env = { ...process.env, ...(SECOND_ONLY ? { QUILT_NEXT_ONLY: 'verify' } : {}) };
delete env.OPENAI_API_KEY;
const quilt = (...a) => execFileSync(bin[0], [...bin.slice(1), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
/** The JSON a CLI command printed, read from its first brace: pnpm run writes its own two lines first unless given -s. */
const jsonOut = (text) => JSON.parse(text.slice(text.indexOf('{')));
const norm = (t) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const evidenceNorm = norm(EVIDENCE);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** The piece as the CLI prints it: its name and hash, the brief, the schema's fields, what is required. */
function readPiece(text) {
  const head = text.match(/Piece (\S+) \((sha256:[0-9a-f]+)\)/);
  const brief = text.match(/wrote this brief: "([\s\S]*?)"\n/)?.[1];
  const fields = text.match(/these fields: (\{[\s\S]*?\}); required: ([^;]*); agreement is on: ([^.]*)\./);
  if (!head || !brief || !fields) return null;
  return { name: head[1], hash: head[2], brief, properties: JSON.parse(fields[1]), required: fields[2].split(',').map((s) => s.trim()).filter(Boolean) };
}

async function ask(piece, note) {
  const schema = { type: 'object', additionalProperties: false, required: Object.keys(piece.properties), properties: {} };
  for (const [k, def] of Object.entries(piece.properties)) schema.properties[k] = def.enum ? { type: 'string', enum: def.enum } : { type: def.type === 'integer' ? 'integer' : def.type === 'number' ? 'number' : def.type === 'boolean' ? 'boolean' : 'string' };
  const body = {
    model: MODEL,
    reasoning: { effort: 'low' },
    input: [
      { role: 'developer', content: 'You work one piece of a problem for a person who published it. The author\'s brief says what is wanted; the evidence, when given, is the only source to rely on. Answer in the shape asked for. A quote is copied verbatim from the evidence, at most 25 words, and is the best support for your answer.' + (note ? ' ' + note : '') },
      { role: 'user', content: `The author wrote this brief: "${piece.brief}"\n\n${EVIDENCE ? `The evidence:\n\n${EVIDENCE}\n\n` : ''}Answer with the fields: ${Object.keys(piece.properties).join(', ')}.` },
    ],
    text: { format: { type: 'json_schema', name: 'answer', strict: true, schema } },
  };
  const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`openai ${r.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  const msg = (j.output ?? []).find((o) => o.type === 'message');
  return JSON.parse(msg?.content?.find((c) => c.type === 'output_text')?.text ?? '{}');
}

/** The CLI's last line on stderr when it stopped: what it said, with nothing to hand out said quietly. */
const quiet = /nothing to verify|nothing for this key|nothing to do/;

/**
 * One problem worked until the CLI hands out nothing more or `budget` pieces are returned: the number returned. A piece
 * the model or the tracker refuses is logged and ends this problem; the run goes on to the next.
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
      let answer = await ask(piece);
      const quoteOk = (a) => typeof a.quote !== 'string' || !EVIDENCE || (evidenceNorm.includes(norm(a.quote)) && a.quote.trim().split(/\s+/).length <= 25);
      if (!quoteOk(answer)) answer = await ask(piece, 'Your previous quote was not found verbatim in the evidence, or ran over 25 words; copy the words exactly as they appear.');
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
if (ALL) {
  const list = await waiting();
  console.log(`${list.length} problem${list.length === 1 ? '' : 's'} with pieces waiting on a second reading${SECOND_ONLY ? '' : ' (every piece is taken, --second-only not given)'}`);
  for (const [i, p] of list.entries()) {
    if (n >= MAX) break;
    if (i > 0) await pause(2000);
    console.log(`${p.problem.slice(0, 19)} "${p.title}": ${p.waiting} waiting`);
    n += await work(p.problem, MAX - n);
  }
} else {
  n = await work(PROBLEM, MAX);
}
console.log(`${n} piece${n === 1 ? '' : 's'} returned as openai/${MODEL}${SECOND_ONLY ? ', each a second reading' : ''}`);
