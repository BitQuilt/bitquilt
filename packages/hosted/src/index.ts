/**
 * What the hosted on-ramp exports, which the node imports: the on-ramp, its environment and its mount. The environment
 * is exported too at the env subpath, which loads no store, so a binary can read it before Node's SQLite module is
 * loaded and its warning silenced.
 */
export { createHosted, type Hosted, type HostedOptions } from './hosted.js';
export { guardReads, hostedOptionsFromEnv, onrampStartLines, type HostedEnv } from './env.js';
export { hostedDoor, scheduleOwnersTurn, type HostedDoorOptions } from './mount.js';
