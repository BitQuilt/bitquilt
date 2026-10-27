/**
 * The home tracker as the jobs reach it. The coin's convention is the opposite of the mirror's: the mirror puts one
 * trailing slash on a tracker's address (`withSlash` in the core) and joins `p/<hash>` onto it, while here a home comes
 * in with or without the slash (DEPLOY.md gives `QUILT_COIN_HOME` with one), `homeUrl` takes it off, and every path
 * joined onto it carries its own leading slash. `homeUrl` is the one place the slash is taken off.
 */

/** The home's address with no trailing slash, for a path with a leading one to be joined onto. */
export const homeUrl = (home: string): string => home.replace(/\/+$/, '');

/** How a job reads the home: the sequence to read the ledger as of, the job's name for the user agent, and the fetch to use. */
export interface HomeRead {
  /** Ask the home for the ledger as it stood at this sequence; absent, its current head. */
  upto?: number | undefined;
  /** The job asking, sent as the user agent, so the home's log says which one it was. */
  agent: string;
  fetchImpl?: typeof fetch | undefined;
}

/** `GET <home><path>` at the home, with `?upto=<seq>` when asked, the answer as JSON handed to `check`. */
export async function fromHome<T>(home: string, path: string, options: HomeRead, check: (answer: unknown) => T): Promise<T> {
  const url = `${homeUrl(home)}${path}${options.upto === undefined ? '' : `?upto=${options.upto}`}`;
  const r = await (options.fetchImpl ?? fetch)(url, { headers: { accept: 'application/json', 'user-agent': options.agent }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`the home answered ${r.status} at ${path}`);
  return check(await r.json());
}
