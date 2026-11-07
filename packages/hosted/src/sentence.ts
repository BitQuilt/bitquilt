/**
 * The sentence a brief lacks, for an owner whose key this tracker holds (QX-19 section 4). A home's node asks the agent
 * CLI on its machine; the on-ramp has none, so it asks a model through the vendor key in its environment, Anthropic's
 * where ANTHROPIC_API_KEY is set, else OpenAI's where OPENAI_API_KEY is, with the same prompt and nothing else in the
 * turn. With neither key there is no way to ask, and the owners' briefs are left as they are. The keys are read from
 * the environment and go into a request header and nowhere else.
 */
import type { SentenceAsk } from 'quilt';
import { sentenceAsk } from 'quilt';

export type Sentence = (q: SentenceAsk) => Promise<string | null>;

/** The models asked when none is named: the house's own defaults (deploy/house.sh). */
export const SENTENCE_MODELS = { anthropic: 'claude-opus-5-5', openai: 'gpt-6-luna' } as const;

/** The vendor the environment names, or null with no key: which key is set, and the model `QUILT_SENTENCE_MODEL` names or the default. */
export function sentenceVendor(
  env: NodeJS.ProcessEnv,
): { vendor: 'anthropic' | 'openai'; key: string; model: string } | null {
  if (env.ANTHROPIC_API_KEY)
    return {
      vendor: 'anthropic',
      key: env.ANTHROPIC_API_KEY,
      model: env.QUILT_SENTENCE_MODEL ?? SENTENCE_MODELS.anthropic,
    };
  if (env.OPENAI_API_KEY)
    return { vendor: 'openai', key: env.OPENAI_API_KEY, model: env.QUILT_SENTENCE_MODEL ?? SENTENCE_MODELS.openai };
  return null;
}

/** The text of a vendor's one answer, or null where the answer has no text. */
export function answerText(vendor: 'anthropic' | 'openai', body: unknown): string | null {
  const j = body as Record<string, unknown>;
  if (vendor === 'anthropic') {
    const content = Array.isArray(j.content) ? (j.content as { type?: string; text?: string }[]) : [];
    const text = content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return text.trim() || null;
  }
  const output = Array.isArray(j.output)
    ? (j.output as { type?: string; content?: { type?: string; text?: string }[] }[])
    : [];
  const message = output.find((o) => o.type === 'message');
  const text = message?.content?.find((c) => c.type === 'output_text')?.text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

/** The function the owner turn asks, over the vendor the environment names; null where it names none. */
export function vendorSentence(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Sentence | null {
  const v = sentenceVendor(env);
  if (!v) return null;
  return async (q) => {
    const prompt = sentenceAsk(q);
    const r =
      v.vendor === 'anthropic'
        ? await fetchImpl('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': v.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: v.model, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
            signal: AbortSignal.timeout(120_000),
          })
        : await fetchImpl('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { authorization: `Bearer ${v.key}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model: v.model, input: prompt }),
            signal: AbortSignal.timeout(120_000),
          });
    if (!r.ok) throw new Error(`${v.vendor} answered ${r.status}`);
    return answerText(v.vendor, await r.json());
  };
}
