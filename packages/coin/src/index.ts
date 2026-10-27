/** The door out and the way back, for the bins, the mirror and the tests. */

// The jobs: the poster, the holder's claim, the reader and the holder's deposit, with their options, reports and doors.
export { post, readRedeems, checkRedeems, redeemRoot, type PosterDoor, type PostOptions, type PostReport, type RedeemLine, type Redeems } from './post.js';
export { claim, type ClaimDoor, type ClaimOptions, type ClaimReport } from './claim.js';
export { read, readCredits, checkCredits, type CreditLine, type Credits, type ReaderDoor, type ReadOptions, type ReadReport } from './read.js';
export { deposit, selfAddress } from './chain.js';

// The connection: from the environment, the reads the mirror and the claim make through it, and the writes the doors default to.
export { chainFromEnv, lastPosted, headAt, isFinal, isRedeemed, depositCount, depositAt, postHead, redeem, type Address, type Chain, type Connection, type Deposit, type PostedHead } from './chain.js';

// The tree over the redeem lines, as Anchors holds its root and Quilt checks a proof against it.
export { leaf, pair, proof, root, verify, type Hex } from './merkle.js';

// For a deployment script and the anvil test, kept here because viem is imported in chain.ts alone.
export { deploy, bond, balanceOf, ANCHORS_ABI, QUILT_ABI, type Abi } from './chain.js';
