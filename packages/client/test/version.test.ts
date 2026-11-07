import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mcpPair, quiltOver } from './helpers.js';

/**
 * The version, which packages/client/package.json holds and a release changes there alone: the connector names it in
 * its handshake, read from that file under vitest as under tsx, and the Mac app's bundle carries the same. The bundle's
 * manifest and its handshake are held in mcpb.test.ts, and the window's card takes it from the same file at its build.
 * The Mac app's build number is its own and stays out of this.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const version = (JSON.parse(readFileSync(join(root, 'packages', 'client', 'package.json'), 'utf8')) as { version: string }).version;

describe('the version', () => {
  it('is a release number in the client package', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is what the connector names in its handshake', async () => {
    const { client, close } = await mcpPair(quiltOver('http://tracker.test/')(1));
    expect(client.getServerVersion()).toMatchObject({ name: 'quilt', version });
    await close();
  });

  it("is the Mac app's short version string, which its menu shows", () => {
    const plist = readFileSync(join(root, 'apps', 'mac', 'Resources', 'Info.plist'), 'utf8');
    const short = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
    expect(short?.[1]).toBe(version);
  });
});
