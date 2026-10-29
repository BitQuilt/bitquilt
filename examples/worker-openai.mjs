#!/usr/bin/env node
/**
 * A worker with no person beside it, on an OpenAI key: an OpenAI model works the agree pieces of one problem through
 * the quilt CLI, or every problem waiting on a second reading (--all --second-only). The loop is
 * examples/worker-loop.mjs; this file is the one call to the model, through the Responses API with the piece's schema
 * as its structured output and, when no evidence file is given, the web search tool, so the source the brief names is
 * read before it answers. Every reveal is declared openai/<model>: QUILT_MODEL is set to the same.
 *
 *   OPENAI_API_KEY=… QUILT_HOME=~/.config/quilt-worker QUILT_TRACKERS=http://localhost:3977/ \
 *     node examples/worker-openai.mjs <problem hash> [evidence.txt] [--model gpt-6-luna] [--max 16] [--second-only]
 */
import { fileURLToPath } from 'node:url';
import { instruction, question, runWorker } from './worker-loop.mjs';

const WITHOUT = 'No evidence is given here: find the source the brief names with web search and read it before answering, and quote from what you read.';

/** The one call: the piece answered in its schema's shape by an OpenAI model, searching for the source itself when no evidence is given. */
export async function ask({ piece, schema, evidence, note, model, key }) {
  const body = {
    model,
    reasoning: { effort: 'low' },
    ...(evidence ? {} : { tools: [{ type: 'web_search' }] }),
    input: [
      { role: 'developer', content: instruction(note) },
      { role: 'user', content: question(piece, evidence, WITHOUT) },
    ],
    text: { format: { type: 'json_schema', name: 'answer', strict: true, schema } },
  };
  const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`openai ${r.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  const msg = (j.output ?? []).find((o) => o.type === 'message');
  return JSON.parse(msg?.content?.find((c) => c.type === 'output_text')?.text ?? '{}');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await runWorker({ vendor: 'openai', keyName: 'OPENAI_API_KEY', defaultModel: 'gpt-6-luna', file: 'examples/worker-openai.mjs', ask });
