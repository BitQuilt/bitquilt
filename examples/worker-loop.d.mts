/** The types of examples/worker-loop.mjs, for the test beside the client. */
export interface Piece { name: string; hash: string; brief: string; properties: Record<string, { type?: string; enum?: string[]; maxLength?: number }>; required: string[] }
export interface WorkerArgs { problem: string | undefined; evidenceFile: string | undefined; model: string; max: number; secondOnly: boolean; all: boolean }
export function parseArgs(args: string[], defaultModel: string): WorkerArgs;
export function readPiece(text: string): Piece | null;
export function schemaOf(piece: Piece): { type: 'object'; additionalProperties: false; required: string[]; properties: Record<string, unknown> };
export function instruction(note: string): string;
export function question(piece: Piece, evidence: string, without?: string): string;
export function runWorker(o: { vendor: string; keyName: string; defaultModel: string; file: string; ask: (a: { piece: Piece; schema: unknown; evidence: string; note: string; model: string; key: string }) => Promise<Record<string, unknown>> }): Promise<void>;
