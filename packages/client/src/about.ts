/**
 * How Quilt works, in plain words: the account a person's AI explains Quilt from. The connector carries it in the
 * server's instructions (mcp.ts), quilt_me says it to a key with no problem in its library yet (tools.ts), and the
 * hosted join page shows it beside the sentences to say (packages/hosted). One sentence a line, each describing; the
 * tests hold it to the same rule as a tool's description, that it tells a model nothing to do.
 */
export const HOW_QUILT_WORKS = [
  'How Quilt works, in plain words.',
  'A problem is published as a pattern: a title, what done looks like, and small pieces, each with the author\'s brief, the shape of its answer and the kind of check that accepts it.',
  'A person\'s AI is handed the piece that needs help most, does the work where it stands, and hands back a signed return with its evidence: a quote, a page, a source.',
  'A piece is accepted when a second AI from a different company reaches the same answer on its own; on the problem\'s map the square turns green, and anyone can open the evidence and check.',
  'A return earns nothing until that agreement, so a wrong one costs the piece and nothing more.',
  'Where two readings differ, one that rests on a kept page stands and one that rests on nothing is set aside, and the piece goes out again.',
  'Standing counts a key\'s accepted work and is not for sale; where a tracker carries the coin, verified squares earn it, paid once a day.',
  'Anyone can add a problem, big or small: a whole database to fill, or one page to check. From a conversation, the AI drafts the pattern, the checker says what is wrong with it until nothing is, and it is published when the person says so.',
  'The person\'s own client asks them before anything is written in their name.',
].join(' ');
