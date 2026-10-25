#!/usr/bin/env node
/**
 * A worker with no person beside it: an OpenAI model works the agree pieces of one problem through the quilt CLI.
 *
 *   OPENAI_API_KEY=… QUILT_HOME=~/.config/quilt-worker QUILT_TRACKERS=http://localhost:3977/ \
 *     node examples/worker-openai.mjs <problem hash> [evidence.txt] [--model gpt-6-luna] [--max 16]
 *
 * For each piece the CLI hands it (rarest first, verifies first), the model gets the author's brief as quoted words,
 * the evidence file if one is given, and the piece's own schema as the shape of its answer. When the schema has a
 * `quote` field and there is evidence, a quote that is not found verbatim in the evidence is asked for once more.
 * The answer is then handed back through `quilt return`, signed by this worker's key, declared as `openai/<model>`
 * (set `model` in the key's config, or QUILT_MODEL, to that same value so the claim says what the reveal says).
 *
 * The CLI is `quilt` on the PATH, or the command in QUILT_BIN; in the repository, `pnpm --filter quilt start` works.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const PROBLEM = positional[0];
const EVIDENCE = positional[1] ? readFileSync(positional[1], 'utf8') : '';
const MODEL = flag('--model', 'gpt-6-luna');
const MAX = Number(flag('--max', '1000'));
const KEY = process.env.OPENAI_API_KEY;
if (!PROBLEM || !KEY) {
  console.error('usage: OPENAI_API_KEY=… node examples/worker-openai.mjs <problem hash> [evidence.txt] [--model m] [--max n]');
  process.exit(2);
}
const bin = (process.env.QUILT_BIN ?? 'quilt').split(' ');
const quilt = (...a) => execFileSync(bin[0], [...bin.slice(1), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const norm = (t) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const evidenceNorm = norm(EVIDENCE);

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

let n = 0;
for (; n < MAX; n++) {
  let text;
  try { text = quilt('next', PROBLEM); } catch (e) { console.log('stopped:', (e.stderr || e.message).trim().split('\n').pop()); break; }
  const piece = readPiece(text);
  if (!piece) { console.log('could not read the piece the CLI printed; this worker handles agree pieces with a schema'); break; }
  let answer = await ask(piece);
  const quoteOk = (a) => typeof a.quote !== 'string' || !EVIDENCE || (evidenceNorm.includes(norm(a.quote)) && a.quote.trim().split(/\s+/).length <= 25);
  if (!quoteOk(answer)) answer = await ask(piece, 'Your previous quote was not found verbatim in the evidence, or ran over 25 words; copy the words exactly as they appear.');
  for (const [k, def] of Object.entries(piece.properties)) if (typeof answer[k] === 'string' && def.maxLength && answer[k].length > def.maxLength) answer[k] = answer[k].slice(0, def.maxLength);
  const r = JSON.parse(quilt('return', PROBLEM, piece.hash, JSON.stringify(answer)));
  console.log(`${piece.name}: ${JSON.stringify(answer)} -> commit ${r.commit.queued ? 'queued' : 'posted'}, reveal ${r.reveal.queued ? 'queued' : 'posted'}${answer.quote && !quoteOk(answer) ? ' (quote not verbatim)' : ''}`);
}
console.log(`${n} pieces returned as openai/${MODEL}`);
