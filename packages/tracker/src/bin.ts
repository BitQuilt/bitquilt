#!/usr/bin/env tsx
/**
 * bitquilt-tracker: run a reference tracker. Configuration comes from the environment and nothing else.
 *   QUILT_PORT (3977)  QUILT_HOST (127.0.0.1)  QUILT_DB (./quilt-tracker.db)  QUILT_URL (http://localhost:<port>/)
 *   QUILT_NAME  QUILT_PEERS (comma-separated)  QUILT_LIMIT_KEY_HOUR (120)  QUILT_LIMIT_IP_HOUR (600)
 *   QUILT_STAMP_NAME (0)  QUILT_IP_SALT
 */
import { Store } from './store.js';
import { createTracker } from './tracker.js';

const port = Number(process.env.QUILT_PORT ?? 3977);
const host = process.env.QUILT_HOST ?? '127.0.0.1';
const url = process.env.QUILT_URL ?? `http://localhost:${port}/`;
const store = new Store(process.env.QUILT_DB ?? './quilt-tracker.db');
const tracker = createTracker({
  store,
  url,
  ...(process.env.QUILT_NAME ? { name: process.env.QUILT_NAME } : {}),
  peers: (process.env.QUILT_PEERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  limits: { keyPerHour: Number(process.env.QUILT_LIMIT_KEY_HOUR ?? 120), ipPerHour: Number(process.env.QUILT_LIMIT_IP_HOUR ?? 600) },
  stamp: { name: Number(process.env.QUILT_STAMP_NAME ?? 0) },
  ...(process.env.QUILT_IP_SALT ? { ipSalt: process.env.QUILT_IP_SALT } : {}),
});
tracker.listen(port, host).then(() => console.log(`bitquilt tracker at ${url} (db ${process.env.QUILT_DB ?? './quilt-tracker.db'})`));
