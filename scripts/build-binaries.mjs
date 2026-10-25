// Builds Quilt and the tracker as single executables for the platform this runs on, with Node's single-executable
// applications: each entry is bundled into one CommonJS file with esbuild, wrapped into a blob with the page's HTML as
// an asset, and injected into a copy of this Node binary with postject. The release workflow runs this on a runner per
// platform; locally it builds for the host.
//
//   node scripts/build-binaries.mjs            -> dist/bin/quilt-<platform>-<arch>, dist/bin/bitquilt-tracker-<platform>-<arch>
import { build } from 'esbuild';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const bin = join(dist, 'bin');
mkdirSync(bin, { recursive: true });
const platform = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? '.exe' : '';
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const targets = [
  { name: 'quilt', entry: 'packages/client/src/bin.ts', assets: { 'index.html': 'packages/client/page/index.html' } },
  { name: 'bitquilt-tracker', entry: 'packages/tracker/src/bin.ts', assets: {} },
];

for (const t of targets) {
  const bundle = join(dist, `${t.name}.cjs`);
  await build({
    entryPoints: [join(root, t.entry)],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: bundle,
    define: { 'process.env.QUILT_VERSION': JSON.stringify(version) },
    logLevel: 'warning',
  });
  // The embedder runs the script as plain CommonJS and takes no shebang, which the entry files carry for tsx.
  writeFileSync(bundle, readFileSync(bundle, 'utf8').replace(/^(#![^\n]*\n)+/, ''));
  const blob = join(dist, `${t.name}.blob`);
  const config = join(dist, `${t.name}.sea.json`);
  writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, assets: Object.fromEntries(Object.entries(t.assets).map(([k, v]) => [k, join(root, v)])) }));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  const out = join(bin, `${t.name}-${platform}${exe}`);
  if (existsSync(out)) rmSync(out);
  copyFileSync(process.execPath, out);
  chmodSync(out, 0o755);
  if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', out]);
  const postject = join(root, 'node_modules', 'postject', 'dist', 'cli.js');
  const args = [postject, out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
  execFileSync(process.execPath, args, { stdio: 'inherit' });
  if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', out]);
  console.log(`built ${out}`);
}
