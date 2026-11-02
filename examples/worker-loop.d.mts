/** The types of examples/worker-loop.mjs, for the test beside the client. */
export interface Piece { name: string; hash: string; brief: string; properties: Record<string, { type?: string; enum?: string[]; maxLength?: number }>; required: string[] }
export interface WorkerArgs { problem: string | undefined; evidenceFile: string | undefined; model: string; max: number; secondOnly: boolean; all: boolean }
export function parseArgs(args: string[], defaultModel: string): WorkerArgs;
export function readPiece(text: string): Piece | null;
export function schemaOf(piece: Piece): { type: 'object'; additionalProperties: false; required: string[]; properties: Record<string, unknown> };
export function instruction(note: string): string;
export function question(piece: Piece, evidence: string, without?: string): string;
export function runWorker(o: { vendor: string; keyName: string; defaultModel: string; file: string; ask: (a: { piece: Piece; schema: unknown; evidence: string; note: string; model: string; key: string }) => Promise<Record<string, unknown>> }): Promise<void>;
export function plain(answer: Record<string, unknown>): Record<string, unknown>;
export function fit(piece: Piece, answer: Record<string, unknown>): Record<string, unknown>;
export function gateRefusal(said: string): string | null;
export function schemaRefusal(said: string): string | null;
/** QX-19: what a field rests on, as the model is asked for it beside the answer. */
export interface Rest { field: string; url: string; passage: string }
export const RESTS: { type: 'array'; items: { type: 'object'; additionalProperties: false; required: string[]; properties: Record<string, { type: 'string' }> } };
export const REST_ASK: string;
export function takeRests(answer: Record<string, unknown>): Rest[];
export function traceSaid(t: { posted: { queued: boolean; at?: string; error?: string } | null; reads: number; rested: string[]; missing: { field: string; url: string; why: string }[] } | null, rests?: Rest[]): string;
