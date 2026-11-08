/**
 * A comment line runs to 120 characters at most, the width the formatter holds the code to (AGENTS.md, Commands). The
 * formatter wraps code and leaves a comment as it is, so the comments are held here: a comment reads whole beside the
 * code it describes, and a diff of one sentence shows that sentence. The lines read are the comment lines of each
 * package's sources and tests, the card's sources, the scripts, the example workers and vitest.config.ts: a line that
 * opens with `//` or a star, a line of a block, and a shell script's `#` line. A comment after code is code's line, and
 * the formatter's. A line is measured in code points, so an astral letter counts as one, not as two UTF-16 units.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CommentSyntax, commentLines, repoRoot as root, sourcesUnder, syntaxOf } from './helpers.js';

const WIDTH = 120;

/** The files whose comment lines are held to the width. */
function files(): string[] {
  const dirs = [join(root, 'packages', 'client', 'window'), join(root, 'scripts')];
  for (const pkg of readdirSync(join(root, 'packages')))
    for (const sub of ['src', 'test']) dirs.push(join(root, 'packages', pkg, sub));
  const examples = readdirSync(join(root, 'examples'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(root, 'examples', name));
  return [...dirs.flatMap((dir) => sourcesUnder(dir)), ...examples, join(root, 'vitest.config.ts')];
}

/** The comment lines of a source that run past the width, by line number from 1. */
function tooWide(text: string, syntax: CommentSyntax): number[] {
  const lines = text.split('\n');
  return commentLines(text, syntax).flatMap((comment, i) =>
    comment != null && [...lines[i]!].length > WIDTH ? [i + 1] : [],
  );
}

describe('a comment line runs to 120 characters', () => {
  it('finds a comment line past the width, of each kind, and passes code past it', () => {
    const long = 'x'.repeat(WIDTH);
    expect(tooWide(`// ${long}\nconst a = '${long}';`, 'slash')).toEqual([1]);
    expect(tooWide(`/**\n * ${long}\n */`, 'slash')).toEqual([2]);
    expect(tooWide(`/* the narrow frame\n   ${long} */`, 'slash')).toEqual([2]);
    expect(tooWide(`# ${long}`, 'hash')).toEqual([1]);
    expect(tooWide(`const a = 1; // ${long}`, 'slash')).toEqual([]);
  });

  it('counts characters, so a line of 120 passes whatever its letters', () => {
    expect(tooWide(`// ${'x'.repeat(WIDTH - 3)}`, 'slash')).toEqual([]);
    expect(tooWide(`// ${'\u{1D465}'.repeat(WIDTH - 3)}`, 'slash')).toEqual([]);
    expect(tooWide(`// ${'x'.repeat(WIDTH - 2)}`, 'slash')).toEqual([1]);
  });

  it('finds none in the code', () => {
    const all = files();
    expect(all.length).toBeGreaterThan(200);
    const wide = all.flatMap((file) =>
      tooWide(readFileSync(file, 'utf8'), syntaxOf(basename(file))!).map(
        (line) => `${relative(root, file).split(sep).join('/')}:${line}`,
      ),
    );
    expect(wide).toEqual([]);
  });
});
