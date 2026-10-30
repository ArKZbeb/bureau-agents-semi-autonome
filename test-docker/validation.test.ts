import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { construireImage } from '../src/conteneurs/image.ts';
import { brancheTache, executerJetable, lireShaVolume, nomRessource, preparerEspace, RACINE_PROJET } from '../src/conteneurs/docker.ts';
import { lireBundle, lireValidation, PLAFOND_DIFF } from '../src/conteneurs/validation.ts';

const docker = new Docker();
const T = 'T-991';
let image: string;
let depot: string;
let tmp: string;
let volume: string;
let base: string;
let pointe: string;

const ecrire = (script: string) => executerJetable(docker, image, ['sh', '-c', `export HOME=/tmp && git config --global --add safe.directory '*' && cd ${RACINE_PROJET} && git config user.name t && git config user.email t@t && ${script}`], [{ Type: 'volume', Source: volume, Target: '/workspace' }]);

before(async () => {
  image = construireImage(process.cwd());
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-valid-'));
  depot = path.join(tmp, 'depot');
  fs.mkdirSync(depot);
  fs.writeFileSync(path.join(depot, 'a.txt'), 'un\n');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: depot });
  volume = await preparerEspace(docker, image, T, depot);
  base = (await lireShaVolume(docker, image, volume))!;
  const r1 = await ecrire(`echo b > b.txt && git add b.txt && git commit -qm un`);
  assert.equal(r1.code, 0, r1.stderr.toString());
  const r2 = await ecrire(`echo deux > a.txt && git add a.txt && git commit -qm deux`);
  assert.equal(r2.code, 0, r2.stderr.toString());
  pointe = (await lireShaVolume(docker, image, volume))!;
});

after(async () => {
  await docker.getVolume(nomRessource(T)).remove({ force: true }).catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('lireValidation : commits, fichiers, diff', async () => {
  const l = await lireValidation(docker, image, volume, base, pointe);
  assert.ok(l);
  assert.equal(l.pointe, pointe);
  assert.equal(l.commits, 2);
  assert.deepEqual(l.fichiers.find(f => f.fichier === 'a.txt'), { fichier: 'a.txt', ajouts: 1, suppressions: 1 });
  assert.deepEqual(l.fichiers.find(f => f.fichier === 'b.txt'), { fichier: 'b.txt', ajouts: 1, suppressions: 0 });
  assert.ok(l.diff.includes('+++ b/b.txt'));
  assert.equal(l.tronque, false);
});

test('lireValidation : base non hexadécimale refusée', async () => {
  assert.equal(await lireValidation(docker, image, volume, '$(touch /tmp/x)', pointe), null);
  assert.equal(await lireValidation(docker, image, volume, base, 'zz'), null);
});

test('lireBundle : bundle importable, pointe contrôlée', async () => {
  const b = await lireBundle(docker, image, volume, T, base, pointe);
  assert.ok(b);
  assert.match(b.subarray(0, 20).toString('latin1'), /^# v[23] git bundle/);
  const f = path.join(tmp, 'x.bundle');
  fs.writeFileSync(f, b);
  const heads = execFileSync('git', ['bundle', 'list-heads', f], { cwd: depot }).toString();
  assert.ok(heads.includes(`${pointe} refs/heads/${brancheTache(T)}`), heads);
  assert.equal(await lireBundle(docker, image, volume, T, base, base), null);
  assert.equal(await lireBundle(docker, image, volume, T, base, 'f'.repeat(40)), null);
});

test('lireValidation : diff au-delà du plafond tronqué', async () => {
  const r = await ecrire(`head -c 3145728 /dev/zero | tr '\\0' 'x' | fold -w 80 > gros.txt && git add gros.txt && git commit -qm gros`);
  assert.equal(r.code, 0, r.stderr.toString());
  const p = (await lireShaVolume(docker, image, volume))!;
  const l = await lireValidation(docker, image, volume, base, p);
  assert.ok(l);
  assert.equal(l.tronque, true);
  assert.ok(l.diff.length <= PLAFOND_DIFF);
});
