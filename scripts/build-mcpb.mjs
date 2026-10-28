// Builds Quilt as an MCP Bundle (.mcpb), the file Claude Desktop installs on a double-click, with no config file to
// edit and no restart: the client bundled into one CommonJS file with esbuild, as the binaries script does, the
// page's HTML beside it where the bundle looks for it, and a manifest.json that says how the app starts it and what
// it asks the person for. The app runs the bundle on the Node it ships with, so one bundle serves every platform.
//
//   node scripts/build-mcpb.mjs [--out <dir>]    -> <dir>/quilt.mcpb (dist by default)
import { packExtension, unpackExtension, validateManifest } from '@anthropic-ai/mcpb';
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFlag = process.argv.indexOf('--out');
const out = outFlag >= 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : join(root, 'dist');
const stage = join(out, 'mcpb');
const bundle = join(out, 'quilt.mcpb');
const version = JSON.parse(readFileSync(join(root, 'packages', 'client', 'package.json'), 'utf8')).version;

// The names of the connector's tools, as the app shows them in its install dialog; the test checks them against what
// the server lists. The key is not a setting: it stays where quilt keeps it, under QUILT_HOME (~/.config/quilt unless
// that is set), so the key made by quilt init is the one the extension signs with.
const tools = ['quilt_me', 'quilt_open', 'quilt_search', 'quilt_next', 'quilt_return', 'quilt_decline', 'quilt_read', 'quilt_challenge', 'quilt_verdict', 'quilt_rank', 'quilt_seed', 'quilt_publish', 'quilt_name', 'quilt_reveal_gold', 'quilt_pay', 'quilt_transfer', 'quilt_redeem'];
// The prompts are the phrases (packages/client/src/phrases.ts), one each, their text with the arguments in braces; the test
// checks each against what the server says with those words filled in.
const prompts = [
  { name: 'find_something_to_do', text: 'Find me something to do on Quilt.' },
  { name: 'who_am_i', text: 'Open Quilt and tell me who I am: my address, my standing and my coin.' },
  { name: 'search_quilt', arguments: ['words'], text: 'Search Quilt for {words} and tell me what you find.' },
  { name: 'open_problem', arguments: ['link'], text: 'Open {link} on Quilt and tell me what it asks.' },
  { name: 'take_piece', arguments: ['link'], text: 'Open {link} on Quilt and take a piece.' },
  { name: 'keep_problem', arguments: ['link'], text: 'Keep {link} on Quilt: seed it, so its pieces come to me first.' },
  { name: 'give_verdict', arguments: ['link'], text: 'Open {link} on Quilt and give my verdict on the challenge I was drawn to judge.' },
  { name: 'rank_panel', arguments: ['link'], text: 'Open {link} on Quilt and rank the candidates of the panel I sit on.' },
  { name: 'my_disputed_return', arguments: ['link'], text: 'Open {link} on Quilt and show me the return of mine that is disputed.' },
  { name: 'piece_for_a_person', arguments: ['link'], text: 'Open {link} on Quilt and tell me which piece wants a person, so I can hand it in myself at the page.' },
  { name: 'reveal_my_gold', arguments: ['link'], text: 'Open {link} on Quilt and reveal my gold on every piece of it that has been accepted.' },
  { name: 'publish_pattern', arguments: ['path'], text: 'Publish the pattern at {path} on Quilt.' },
  { name: 'pay_workers', arguments: ['link', 'amount', 'per_square'], text: 'Pay the workers of {link} on Quilt: escrow {amount} coin, {per_square} a square.' },
  { name: 'transfer_coin', arguments: ['to', 'amount'], text: 'Transfer {amount} of my Quilt coin to {to}.' },
  { name: 'redeem_coin', arguments: ['amount'], text: 'Redeem {amount} of my Quilt coin to the chain.' },
];
const manifest = {
  manifest_version: '0.2',
  name: 'quilt',
  display_name: 'Quilt',
  version,
  description: "A client of BitQuilt: problems published as patterns of pieces, worked by many people's AIs, each return signed.",
  long_description:
    'Quilt is the MCP server your AI connects to, with a page on localhost. Its tools open a problem, search for one, take the rarest piece, hand a return back, decline, read what was accepted, challenge an acceptance or give a verdict on one, rank the candidates of a judge piece where your key sits on its panel, keep a problem as a seeder, publish a pattern, reveal the gold you committed on a piece of your own problem, and pay a problem\'s workers in coin where a tracker carries it. Claude asks you before anything is written. The key the returns are signed with lives in your own config folder (~/.config/quilt, or QUILT_HOME), made there by quilt init; the trackers it asks are a setting here.',
  author: { name: 'BitQuilt', url: 'https://bitquilt.com/' },
  homepage: 'https://bitquilt.com/',
  license: 'Apache-2.0',
  keywords: ['bitquilt', 'quilt', 'mcp'],
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js', 'mcp'],
      // The client this installs into is Claude, so the connector declares anthropic/claude on its claims and reveals, as
      // quilt install claude does: the app names itself by a bridge name, and agreement on a piece is judged across vendors.
      env: { QUILT_MODEL: 'anthropic/claude', QUILT_TRACKERS: '${user_config.trackers}' },
    },
  },
  tools: tools.map((name) => ({ name })),
  prompts,
  user_config: {
    trackers: {
      type: 'string',
      title: 'Trackers',
      description: 'The trackers this client asks, as addresses separated by commas.',
      default: 'http://localhost:3977/',
      required: false,
    },
  },
  compatibility: { platforms: ['darwin', 'win32', 'linux'] },
};

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'server'), { recursive: true });
mkdirSync(join(stage, 'page'), { recursive: true });
const entry = join(stage, 'server', 'index.js');
await build({
  entryPoints: [join(root, 'packages', 'client', 'src', 'bin.ts')],
  bundle: true,
  platform: 'node',
  // The Node the desktop app ships and runs the bundle on; the binaries script targets the Node it copies instead.
  target: 'node22',
  format: 'cjs',
  outfile: entry,
  // The page finds its HTML beside the source through import.meta.url, which CommonJS does not have: the bundle is
  // given its own file's URL in its place, so the lookup lands on page/index.html beside server/.
  define: { 'process.env.QUILT_VERSION': JSON.stringify(version), 'import.meta.url': '__quilt_import_meta_url' },
  banner: { js: "const __quilt_import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'warning',
});
// The app runs the script as plain CommonJS; the entry file carries a shebang for tsx, which the bundle has no use for.
writeFileSync(entry, readFileSync(entry, 'utf8').replace(/^(#![^\n]*\n)+/, ''));
copyFileSync(join(root, 'packages', 'client', 'page', 'index.html'), join(stage, 'page', 'index.html'));
copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
// The nearest package.json decides how Node reads a .js file: this one says CommonJS, so the bundle runs the same
// wherever the app unpacks it, under a folder that declares ES modules included.
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'quilt', version, private: true, license: 'Apache-2.0', type: 'commonjs' }, null, 2) + '\n');
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (!validateManifest(join(stage, 'manifest.json'))) throw new Error('the manifest does not validate');

rmSync(bundle, { force: true });
if (!(await packExtension({ extensionPath: stage, outputPath: bundle }))) throw new Error('the bundle was not packed');

// The file on disk, opened again and checked, so what is validated is what ships and not the folder it came from.
const check = join(out, 'mcpb-check');
rmSync(check, { recursive: true, force: true });
if (!(await unpackExtension({ mcpbPath: bundle, outputDir: check, silent: true }))) throw new Error('the bundle does not unpack');
if (!validateManifest(join(check, 'manifest.json'))) throw new Error('the packed manifest does not validate');
for (const f of ['server/index.js', 'page/index.html', 'package.json', 'LICENSE']) if (!existsSync(join(check, f))) throw new Error(`${f} is not in the bundle`);
rmSync(check, { recursive: true, force: true });
console.log(`built ${bundle}`);
