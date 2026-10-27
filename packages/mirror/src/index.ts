/** The mirror job for a script or a test: the run, the anchoring, and the folds over the identity log. */
export { mirror, type DepositReader, type MirrorOptions, type MirrorReport } from './mirror.js';
export { anchorHeads, anchorsHeld, type AnchorReport, type ChainHead } from './anchor.js';
export { hiddenFromIdentity, keysFromIdentity } from './identity.js';
