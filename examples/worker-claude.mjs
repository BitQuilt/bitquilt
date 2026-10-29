#!/usr/bin/env node
/**
 * A worker with no person beside it, on a Claude API key: a Claude model works the agree pieces of one problem through
 * the quilt CLI, or every problem waiting on a second reading (--all --second-only: the house second opinion,
 * docs/DEPLOY.md). The loop is examples/worker-loop.mjs; this file is the one call to the model.
 *
 *   ANTHROPIC_API_KEY=… QUILT_HOME=~/.config/quilt-worker QUILT_TRACKERS=http://localhost:3977/ \
 *     node examples/worker-claude.mjs <problem hash> [evidence.txt] [--model claude-opus-5-5] [--max 16] [--second-only]
 *
 * The model is given the author's brief as quoted words and the evidence file when there is one; without one it is
 * given the search and fetch tools, so a source the brief names by an id (a PubMed Central id, a DOI, a title) is
 * found and read before it answers. The answer comes back in the piece's own schema, through the API's structured
 * output. A turn the server pauses on its tools is resumed, up to five times; a reading the model declines is not
 * returned. Every reveal is declared anthropic/<model>: QUILT_MODEL is set to the same, so the claim says what the
 * reveal says.
 */
import Anthropic from '@anthropic-ai/sdk';
import { instruction, question, runWorker } from './worker-loop.mjs';

const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
];
const WITHOUT = 'No evidence is given here: find the source the brief names with the search tool and read it with the fetch tool before answering, and quote from what you read.';

async function ask({ piece, schema, evidence, note, model, key }) {
  const client = new Anthropic({ apiKey: key });
  const messages = [{ role: 'user', content: question(piece, evidence, WITHOUT) }];
  let response;
  for (let turn = 0; turn < 6; turn++) {
    response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: instruction(note),
      ...(evidence ? {} : { tools: TOOLS }),
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      messages,
    });
    if (response.stop_reason !== 'pause_turn') break;
    // The server paused its own tool loop: the turn so far goes back as the assistant's, and it resumes where it was.
    messages.push({ role: 'assistant', content: response.content });
  }
  if (response.stop_reason === 'refusal') throw new Error(`claude declined this piece${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
  if (response.stop_reason === 'pause_turn') throw new Error('claude did not finish reading within six turns');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

await runWorker({ vendor: 'anthropic', keyName: 'ANTHROPIC_API_KEY', defaultModel: 'claude-opus-5-5', file: 'examples/worker-claude.mjs', ask });
