/**
 * CORE.md sections 2 and 3: the envelope's validity, the problem's hash over `problem` alone, and the expansion of a
 * family to pieces named by hash with their data slots filled and their return slots left as written. The slug's rule
 * is exported as `isSlug` with its words, and the envelope's check reads it. What an `inputs` entry names is answered
 * over pieces indexed once (`inputsBy`) as by a pass over every piece (`inputPieces`), and a blob that several
 * families' slots draw on fills each of them from the same rows.
 */
import { describe, expect, it } from 'vitest';
import { hashBytes } from '../src/hash.js';
import {
  blobProblems,
  envelopeProblems,
  expandPieces,
  inputPieces,
  inputsBy,
  isSlug,
  problemHash,
  renderBrief,
  SLUG_RULE,
  type Envelope,
} from '../src/envelope.js';

const cites = new TextEncoder().encode(
  JSON.stringify([
    { sentence: 'Evaluations underestimate capabilities.', source: 'Chen et al. 2025' },
    { sentence: 'Models generalise across languages.', source: 'Okafor 2024' },
  ]),
);
const citesHash = hashBytes(cites);
const blobs = new Map([[citesHash, cites]]);

export const envelope: Envelope = {
  quilt: 1,
  problem: {
    title: 'Does the report say what its sources say?',
    done_when: 'Every citation has a verdict.',
    owner: '0x4E5f9B1a2C3d4E5f6A7B8C9D0E1F2A3b4c5D6E7f',
    slug: 'report-2026',
    prev: null,
    from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 10, budget: 100, patch_max: 100000 },
    pieces: {
      'cite/*': {
        count: 2,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Citation {n}: {cite.sentence} Source: {cite.source} Return the verdict. {other.thing} stays.',
        data: { cite: 'cites.json' },
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict'],
          properties: { verdict: { enum: ['supports', 'contradicts'] } },
        },
        agree: ['verdict'],
      },
      summary: {
        verifier: 'judge:5',
        inputs: ['cite/*'],
        candidates: 3,
        brief: 'Write the summary from {cite/*}.',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: { type: 'string', maxLength: 4800 } },
        },
      },
      lint: {
        verifier: 'check',
        requires: ['shell'],
        brief: 'Run the lint.',
        workspace: { repo: 'https://example.org/repo', base: 'a1b2c3' },
        check: { file: 'checks/lint.sh', image: 'sha256:' + 'ab'.repeat(32) },
      },
    },
    data: { 'cites.json': citesHash },
  },
  hints: { trackers: ['https://tracker.example/'], mirrors: [] },
  sig: '0x' + '00'.repeat(65),
};

describe('the envelope', () => {
  it('is valid as written, and its hash is over the problem alone', () => {
    expect(envelopeProblems(envelope)).toEqual([]);
    expect(blobProblems(envelope.problem, blobs)).toEqual([]);
    const h = problemHash(envelope);
    expect(
      problemHash({
        ...envelope,
        hints: { trackers: [], mirrors: ['https://m.example/'] },
        sig: '0x' + '11'.repeat(65),
      }),
    ).toBe(h);
    expect(problemHash({ ...envelope, problem: { ...envelope.problem, title: 'Other' } })).not.toBe(h);
  });
  it('refuses a slug with capitals or spaces, more pieces than the budget, an agree field the schema lacks, a capability outside the list, a check piece without its workspace, an input naming no piece, an owner without its checksum, and a blob that is not present', () => {
    const p = envelope.problem;
    expect(envelopeProblems({ ...envelope, problem: { ...p, slug: 'Bad Slug' } })).toContain(
      'problem.slug: lower-case letters, digits and hyphens, at most 64',
    );
    expect(envelopeProblems({ ...envelope, problem: { ...p, settings: { ...p.settings, budget: 2 } } })[0]).toMatch(
      /over the budget/,
    );
    expect(
      envelopeProblems({
        ...envelope,
        problem: { ...p, pieces: { ...p.pieces, 'cite/*': { ...p.pieces['cite/*']!, agree: ['nope'] } } },
      }),
    ).toContain('problem.pieces.cite/*.agree: names fields the schema has');
    expect(
      envelopeProblems({
        ...envelope,
        problem: { ...p, pieces: { ...p.pieces, 'cite/*': { ...p.pieces['cite/*']!, requires: ['teleport'] } } },
      })[0],
    ).toMatch(/requires: from web, files, shell, person/);
    const { workspace: _w, ...lintNoWorkspace } = p.pieces.lint!;
    expect(
      envelopeProblems({ ...envelope, problem: { ...p, pieces: { ...p.pieces, lint: lintNoWorkspace } } }),
    ).toContain('problem.pieces.lint.workspace: repo and base');
    expect(
      envelopeProblems({
        ...envelope,
        problem: { ...p, pieces: { ...p.pieces, summary: { ...p.pieces.summary!, inputs: ['ghost'] } } },
      }),
    ).toContain('problem.pieces.summary.inputs: ghost is not a piece of this problem');
    expect(envelopeProblems({ ...envelope, problem: { ...p, owner: p.owner.toLowerCase() } })).toContain(
      'problem.owner: an address with its checksum',
    );
    expect(blobProblems(p, new Map())).toEqual([`blob cites.json: ${citesHash} not present`]);
  });
  it("says a slug is one by the rule the envelope holds its own to, and refuses the envelope in the rule's words", () => {
    const p = envelope.problem;
    for (const slug of ['x', 'report-2026', `a${'0'.repeat(62)}z`]) {
      expect(isSlug(slug), slug).toBe(true);
      expect(envelopeProblems({ ...envelope, problem: { ...p, slug } }), slug).toEqual([]);
    }
    for (const slug of ['', '..', 'a/b', '../../x', 'Bad', '-a', 'a-', 'a b', 'a'.repeat(65), 7, null]) {
      expect(isSlug(slug), String(slug)).toBe(false);
      expect(envelopeProblems({ ...envelope, problem: { ...p, slug: slug as string } }), String(slug)).toEqual([
        `problem.slug: ${SLUG_RULE}`,
      ]);
    }
    expect(SLUG_RULE).toBe('lower-case letters, digits and hyphens, at most 64');
  });
  it('expands families to pieces named by hash, fills data slots and leaves return slots as written', () => {
    const pieces = expandPieces(envelope.problem, blobs);
    expect(pieces.map((x) => x.name)).toEqual(['cite/1', 'cite/2', 'summary', 'lint']);
    expect(pieces[0]!.brief).toBe(
      'Citation 1: Evaluations underestimate capabilities. Source: Chen et al. 2025 Return the verdict. {other.thing} stays.',
    );
    expect(pieces[1]!.brief).toContain('Citation 2: Models generalise');
    expect(pieces[0]!.hash).not.toBe(pieces[1]!.hash);
    expect(pieces[0]!.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(pieces[2]!.inputs).toEqual(['cite/*']);
    expect(inputPieces('cite/*', pieces).map((x) => x.n)).toEqual([1, 2]);
    expect(inputPieces('lint', pieces).map((x) => x.name)).toEqual(['lint']);
    expect(pieces[3]!.requires).toEqual(['shell']);
  });
  it('answers each inputs entry over pieces indexed once as over every piece, in their order', () => {
    const pieces = expandPieces(envelope.problem, blobs);
    // A single piece whose name is a family's piece's, and one named as a family is, beside the envelope's own.
    const lone = (name: string) => ({
      ...pieces[2]!,
      name,
      family: name,
      n: 1,
      hash: hashBytes(new TextEncoder().encode(name)),
    });
    const all = [...pieces, lone('cite/2'), lone('cite')];
    const named = inputsBy(all);
    for (const entry of ['cite/*', 'cite/2', 'cite', 'summary', 'lint', 'nothing', 'nothing/*', 'constructor'])
      expect(named(entry)).toEqual(inputPieces(entry, all));
    expect(named('cite/*').map((x) => x.name)).toEqual(['cite/1', 'cite/2', 'cite']);
  });
  it('fills each family from the rows of the blob its slot names, one blob drawn on by several', () => {
    const others = new TextEncoder().encode(JSON.stringify([{ source: 'Ito 2023' }, { source: 'Diaz 2022' }]));
    const cite = envelope.problem.pieces['cite/*']!;
    const more = {
      ...envelope.problem,
      pieces: {
        ...envelope.problem.pieces,
        'again/*': { ...cite, brief: 'Again {n}: {row.source}', data: { row: 'cites.json' } },
        'other/*': { ...cite, brief: 'Other {n}: {cite.source}', data: { cite: 'others.json' } },
      },
      data: { ...envelope.problem.data, 'others.json': hashBytes(others) },
    };
    const pieces = expandPieces(more, new Map([...blobs, [hashBytes(others), others]]));
    const briefs = (family: string) => pieces.filter((x) => x.family === family).map((x) => x.brief);
    expect(briefs('again')).toEqual(['Again 1: Chen et al. 2025', 'Again 2: Okafor 2024']);
    expect(briefs('other')).toEqual(['Other 1: Ito 2023', 'Other 2: Diaz 2022']);
    expect(pieces.filter((x) => x.family === 'cite')).toEqual(
      expandPieces(envelope.problem, blobs).filter((x) => x.family === 'cite'),
    );
  });
  it('gives the same piece hash in a new version that keeps the piece, and a new one when the brief changes', () => {
    const v1 = expandPieces(envelope.problem, blobs);
    const v2 = expandPieces({ ...envelope.problem, title: 'A new title', prev: problemHash(envelope) }, blobs);
    expect(v2[0]!.hash).toBe(v1[0]!.hash);
    const changed = expandPieces(
      {
        ...envelope.problem,
        pieces: {
          ...envelope.problem.pieces,
          'cite/*': { ...envelope.problem.pieces['cite/*']!, brief: 'Different {n}' },
        },
      },
      blobs,
    );
    expect(changed[0]!.hash).not.toBe(v1[0]!.hash);
  });
  it('fills {n} and a data slot by its path, renders a missing value as nothing, and leaves a slot naming no data as written', () => {
    expect(renderBrief('n={n} a={row.a} missing={row.zz} keep={x.y}', 3, { row: { a: 'A' } })).toBe(
      'n=3 a=A missing= keep={x.y}',
    );
  });
});
