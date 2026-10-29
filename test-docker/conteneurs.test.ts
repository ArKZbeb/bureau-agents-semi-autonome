import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { construireImage } from '../src/conteneurs/image.ts';
import {
  arreterConteneurs, assurerPasserelle, creerConteneurAgent, executerDans, lireFichierConteneur, lireFichierVolume,
  fichierParametresVides, nomRessource, preparerEspace, preparerReseau, RACINE_PROJET, supprimerReseau, verifierImage,
} from '../src/conteneurs/docker.ts';

const docker = new Docker();
const T = 'T-990';
let image: string;
let depot: string;

before(() => {
  image = construireImage(process.cwd());
  depot = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-depot-'));
  fs.writeFileSync(path.join(depot, 'README.md'), '# Film');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: depot });
});

after(async () => {
  await arreterConteneurs(docker, T);
  await supprimerReseau(docker, T);
  await docker.getVolume(nomRessource(T)).remove({ force: true }).catch(() => {});
});

test('image vérifiée par son ID', async () => {
  await verifierImage(docker, image);
  await assert.rejects(verifierImage(docker, `sha256:${'0'.repeat(64)}`), /absente ou différente/);
});

test('préparation : clone sans réseau, branche de la tâche', async () => {
  const volume = await preparerEspace(docker, image, T, depot);
  assert.equal(await lireFichierVolume(docker, image, volume, `${RACINE_PROJET}/README.md`), '# Film');
  assert.equal((await lireFichierVolume(docker, image, volume, `${RACINE_PROJET}/.git/HEAD`))?.trim(), 'ref: refs/heads/task/990');
  assert.equal(await lireFichierVolume(docker, image, volume, '/etc/passwd'), null, 'lecture limitée au volume');
});

test('conteneur durci : non root, racine en lecture seule, sans capacité, sans socket ni sortie réseau', async () => {
  await assurerPasserelle(docker, image, 47999);
  const reseau = await preparerReseau(docker, T);
  const c = await creerConteneurAgent(docker, { tacheId: T, imageId: image, reseau, volume: nomRessource(T), env: ['BUREAU_JETON=jeton'], ressources: { memoire: 512 * 1024 ** 2, cpus: 1, pids: 128 }, parametresVides: fichierParametresVides(fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-donnees-'))) });
  const info = await c.inspect();
  assert.equal(info.Config.User, 'node');
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(info.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(info.HostConfig.SecurityOpt, ['no-new-privileges']);
  assert.equal(info.HostConfig.Privileged, false);
  assert.equal(info.HostConfig.Memory, 512 * 1024 ** 2);
  assert.equal(info.HostConfig.PidsLimit, 128);
  assert.ok(!JSON.stringify(info.Mounts).includes('docker.sock'));

  const sh = async (script: string) => {
    let s = '';
    const r = await executerDans(c, ['sh', '-c', script], m => (s += m.toString('utf8')));
    return { code: r.code, sortie: s.trim() };
  };
  assert.equal((await sh('id -u')).sortie, '1000');
  assert.notEqual((await sh('touch /etc/pirate')).code, 0);
  assert.notEqual((await sh('echo {} > /etc/claude-code/managed-settings.json')).code, 0);
  assert.notEqual((await sh('echo x > /opt/hooks/hook-gardien.mjs')).code, 0);
  assert.equal((await sh('touch /workspace/projet/ok && echo oui')).sortie, 'oui');
  assert.equal((await sh('test -e /var/run/docker.sock && echo present || echo absent')).sortie, 'absent');
  assert.match((await sh(`node -e "fetch('https://registry.npmjs.org',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('OUVERT'),()=>console.log('BLOQUE'))"`)).sortie, /BLOQUE/);
  assert.notEqual((await sh(`echo '{"env":{"X":"1"}}' > /workspace/.etat-claude/settings.json`)).code, 0);
  assert.equal((await sh('cat /workspace/.etat-claude/settings.json')).sortie, '{}');
  assert.equal(await lireFichierConteneur(c, `${RACINE_PROJET}/README.md`), '# Film');
  assert.equal(await arreterConteneurs(docker, T), 1);
});
