/**
 * What the four bins share, so each is its argument parsing and one call: the connection read from the environment
 * with a refusal printed as usage, a ledger secret read the same way, and one job run to a line of JSON and an exit
 * code. The poster and the reader run on the tracker's host under its keys; the claim and the deposit on a holder's
 * machine under theirs; that is why there are four bins and not one. A bin exits 1 when the home or the chain
 * refused, 2 when the environment or an argument is short. Nothing printed here carries a key.
 */
import { type Chain, chainFromEnv } from './chain.js';
import { KEY_HEX_RE } from './shapes.js';

/** Prints `message` as usage and exits 2: the environment or an argument is short. */
export function usage(message: string): never {
  console.error(`usage: ${message}`);
  process.exit(2);
}

/** The connection from the environment, the key read from `keyVar` (`QUILT_POSTER_KEY` unless another is named) and the home where `home` asks for one; a refusal is printed as usage. */
export function fromEnv(options: { home: true; keyVar?: string }): { chain: Chain; home: string };
export function fromEnv(options?: { home?: false; keyVar?: string }): { chain: Chain; home: string | null };
export function fromEnv(options: { home?: boolean; keyVar?: string } = {}): { chain: Chain; home: string | null } {
  let config: ReturnType<typeof chainFromEnv>;
  try {
    config = chainFromEnv(process.env, options.keyVar === undefined ? {} : { keyVar: options.keyVar });
  } catch (e) {
    usage((e as Error).message);
  }
  if (options.home && !config.home) usage('QUILT_COIN_HOME names the home tracker');
  return config;
}

/** A 32-byte secret from the environment variable `name`, hex with or without 0x, as the reader's ledger key comes in `QUILT_READER_KEY`; a refusal is printed as usage. */
export function secretFromEnv(name: string): Uint8Array {
  const raw = (process.env[name] ?? '').trim().replace(/^0x/, '');
  if (!KEY_HEX_RE.test(raw)) usage(`${name} is 64 hex characters`);
  return Uint8Array.from(Buffer.from(raw, 'hex'));
}

/** Runs the job named `name`: its report printed as one line of JSON and exit 0; exit 1 when it failed, with the reason, or, with `exitOnRefused`, when its report lists refusals. */
export function run(name: string, job: () => Promise<object>, exitOnRefused = false): void {
  job().then(
    (report) => {
      console.log(JSON.stringify(report));
      const refused = (report as { refused?: unknown[] }).refused;
      process.exit(exitOnRefused && refused?.length ? 1 : 0);
    },
    (e) => {
      console.error(`the ${name} failed: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
