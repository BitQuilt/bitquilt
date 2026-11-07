import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { version as built } from '../../../scripts/build-window.mjs';
import { mcpPair, quiltOver } from './helpers.js';

/**
 * The version, whose one source is packages/client/package.json. The connector names it in its handshake, read from
 * that file under vitest as under tsx. The build scripts read it once, in build-window.mjs, and write it into the card,
 * the executables and the bundle; mcpb.test.ts holds the bundle's manifest and handshake to it. A release changes the
 * version in packages/client/package.json and in apps/mac/Resources/Info.plist, which this file holds to it. The Mac
 * app's build number is its own and stays out of this.
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

  it('is read once by the build scripts, in build-window.mjs, and the executables and the bundle take it from there', () => {
    expect(built).toBe(version);
    // The root package.json is the workspace's and says 0.0.0, so a script that read its own would name the wrong one.
    for (const script of ['build-binaries.mjs', 'build-mcpb.mjs']) {
      const text = readFileSync(join(root, 'scripts', script), 'utf8');
      expect(text).toMatch(/import \{[^}]*\bversion\b[^}]*\} from '\.\/build-window\.mjs'/);
      expect(text).toContain("'process.env.QUILT_VERSION': JSON.stringify(version)");
      expect(text).not.toMatch(/readFileSync\([^)]*package\.json/);
    }
  });

  it("is the Mac app's short version string, which its menu shows", () => {
    const plist = readFileSync(join(root, 'apps', 'mac', 'Resources', 'Info.plist'), 'utf8');
    const short = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
    expect(short?.[1]).toBe(version);
  });
});
