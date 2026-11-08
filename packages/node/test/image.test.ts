/**
 * The image (Dockerfile, docs/DEPLOY.md, Build and run): its command is bitquilt-node, with the roles admit and host
 * and the node's home at /data, which is what deploy/docker-compose.yml runs for the public door. The store and the
 * members' homes stay where the hosted binary kept them, under the volume. Every service the compose file builds from
 * the image names its own command, so the image's default starts nothing the host runs; the two doors name their roles
 * and their home, and the houses their own home for the key they sign with (deploy/house.sh).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

/** The services of a compose file, by name, each with the lines under it. */
function services(compose: string): Map<string, string> {
  const body = compose.slice(compose.indexOf('\nservices:\n'));
  const out = new Map<string, string>();
  let name: string | null = null;
  for (const line of body.split('\n').slice(2)) {
    if (/^\S/.test(line)) break;
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) out.set((name = head[1]!), '');
    else if (name) out.set(name, `${out.get(name)!}${line}\n`);
  }
  return out;
}

/** The value a service's environment gives a name, or undefined where it gives none. */
const setting = (body: string, name: string): string | undefined =>
  new RegExp(`^ {6}${name}: (.+)$`, 'm').exec(body)?.[1]?.trim();

describe('the image', () => {
  const docker = read('Dockerfile');
  const env = new Map(
    [...docker.matchAll(/^ENV (.+)$/gm)].flatMap((m) =>
      m[1]!.split(/\s+/).map((pair) => pair.split('=') as [string, string]),
    ),
  );

  it('runs bitquilt-node with the roles admit and host, its home and its store under the volume', () => {
    expect(/^CMD (.+)$/m.exec(docker)?.[1]).toBe('["pnpm", "--filter", "@bitquilt/node", "start"]');
    const node = JSON.parse(read('packages/node/package.json')) as {
      bin: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(node.scripts.start).toBe(`tsx ${node.bin['bitquilt-node']!.replace(/^\.\//, '')}`);
    expect(Object.fromEntries(env)).toMatchObject({
      QUILT_ROLES: 'admit,host',
      QUILT_HOME: '/data',
      QUILT_DB: '/data/tracker.db',
      QUILT_HOSTED_HOME: '/data/hosted',
    });
    expect(docker).toMatch(/^VOLUME \/data$/m);
  });

  it('is started by the compose file only with a command each service names, as the public door already ran', () => {
    const built = [...services(read('deploy/docker-compose.yml'))].filter(([, body]) => /^ {4}build:/m.test(body));
    expect(built.map(([name]) => name)).toEqual(['tracker', 'house', 'house-openai', 'tracker-two']);
    for (const [name, body] of built) expect(body, name).toMatch(/^ {4}command: \[.+\]$/m);
    const doors = built.filter(([, body]) => body.includes('"@bitquilt/node", "start"'));
    expect(doors.map(([name]) => name)).toEqual(['tracker', 'tracker-two']);
    expect(doors.map(([, body]) => [setting(body, 'QUILT_ROLES'), setting(body, 'QUILT_HOME')])).toEqual([
      ['admit,host', '/data'],
      ['admit', '/data'],
    ]);
    const houses = built.filter(([, body]) => body.includes('deploy/house.sh'));
    expect(houses.map(([, body]) => setting(body, 'QUILT_HOME'))).toEqual(['/house', '/house-openai']);
  });
});
