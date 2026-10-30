import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { construireImage } from '../src/conteneurs/image.ts';
import {
  arreterConteneurs, assurerPasserelle, creerConteneurAgent, demultiplexer, executerDans, lireFichierConteneur, lireFichierVolume,
  resoudreCheminConteneur, resoudreCheminVolume,
  fichierParametresVides, nomCopie, nomRessource, preparerCopieControle, supprimerCopieControle, preparerEspace, preparerReseau, RACINE_PROJET, supprimerReseau, verifierImage,
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
  await assert.rejects(preparerEspace(docker, image, T, depot), /existe déjà/);
  assert.equal(await lireFichierVolume(docker, image, volume, `${RACINE_PROJET}/README.md`), '# Film', 'espace existant intact');
  assert.equal(await lireFichierVolume(docker, image, volume, '/etc/passwd'), null, 'lecture limitée au volume');
  assert.equal(await lireFichierVolume(docker, image, volume, '/workspace/../etc/passwd'), null, 'remontée refusée');
});

test('conteneur durci : non root, racine en lecture seule, sans capacité, sans socket ni sortie réseau', async () => {
  await assurerPasserelle(docker, image, 47999);
  const reseau = await preparerReseau(docker, T);
  assert.equal((await docker.getNetwork(reseau).inspect()).Internal, true);
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
  assert.equal((await sh('npm config get cache')).sortie, '/tmp/.npm', 'cache npm hors de la racine en lecture seule');
  assert.equal((await sh('npm cache verify > /dev/null 2>&1 && echo oui')).sortie, 'oui', 'cache npm inscriptible');
  assert.equal((await sh('test -e /var/run/docker.sock && echo present || echo absent')).sortie, 'absent');
  assert.match((await sh(`node -e "fetch('https://registry.npmjs.org',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('OUVERT'),()=>console.log('BLOQUE'))"`)).sortie, /BLOQUE/);
  assert.notEqual((await sh(`echo '{"env":{"X":"1"}}' > /workspace/.etat-claude/settings.json`)).code, 0);
  assert.equal((await sh('cat /workspace/.etat-claude/settings.json')).sortie, '{}');
  assert.equal(await lireFichierConteneur(c, `${RACINE_PROJET}/README.md`), '# Film');
  assert.equal(await lireFichierConteneur(c, '/workspace/../etc/passwd'), null);
  assert.equal((await sh('ln -s /etc/passwd /workspace/projet/lien && mkfifo /workspace/projet/f')).code, 0);
  assert.equal(await lireFichierConteneur(c, `${RACINE_PROJET}/lien`), null, 'lien symbolique refusé');
  assert.equal(await lireFichierConteneur(c, `${RACINE_PROJET}/f`), null, 'FIFO refusée');
  assert.equal(await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/lien`), null, 'lien symbolique refusé (volume)');
  assert.equal(await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/f`), null, 'FIFO refusée (volume)');
  assert.equal((await sh('mkdir -p /workspace/projet/src && ln -s ../.git/hooks/pre-commit /workspace/projet/src/x')).code, 0);
  for (const resoudre of [(p: string) => resoudreCheminConteneur(c, p), (p: string) => resoudreCheminVolume(docker, image, nomRessource(T), p)]) {
    assert.equal(await resoudre(`${RACINE_PROJET}/src/x`), `${RACINE_PROJET}/.git/hooks/pre-commit`, 'lien vers les hooks Git résolu');
    assert.equal(await resoudre(`${RACINE_PROJET}/lien`), '/etc/passwd');
    assert.equal(await resoudre(`${RACINE_PROJET}/README.md`), `${RACINE_PROJET}/README.md`, 'fichier normal inchangé');
    assert.equal(await resoudre(`${RACINE_PROJET}/src/nouveau.ts`), `${RACINE_PROJET}/src/nouveau.ts`, 'fichier à créer : chemin normalisé');
  }
  assert.equal(await arreterConteneurs(docker, T), 1);
});

async function executerSurVolume(volume: string, script: string): Promise<void> {
  const c = await docker.createContainer({ Image: image, User: 'node', Cmd: ['sh', '-c', script], HostConfig: { NetworkMode: 'none', Mounts: [{ Type: 'volume', Source: volume, Target: '/workspace' }] } });
  await c.start();
  await c.wait();
  await c.remove({ force: true });
}

test('copie de contrôle : branche committée seulement, modifications jetées', async () => {
  const id = `T-CTRL-${Date.now()}`;
  try {
    await preparerEspace(docker, image, id, depot);
    await executerSurVolume(nomRessource(id), 'echo x > /workspace/cadrage/spec.md');
    assert.equal(await lireFichierVolume(docker, image, nomRessource(id), '/workspace/cadrage/spec.md'), 'x\n');
    // Fichier non commité dans l'espace de la tâche : absent de la copie.
    await executerSurVolume(nomRessource(id), `echo brouillon > ${RACINE_PROJET}/brouillon.txt`);
    const copie = await preparerCopieControle(docker, image, id);
    assert.equal(copie, nomCopie(id));
    assert.equal(await lireFichierVolume(docker, image, copie, `${RACINE_PROJET}/brouillon.txt`), null);
    assert.notEqual(await lireFichierVolume(docker, image, copie, `${RACINE_PROJET}/README.md`), null);
    // Écriture dans la copie : sans effet sur la branche.
    await executerSurVolume(copie, `echo modifie > ${RACINE_PROJET}/README.md`);
    assert.notEqual(await lireFichierVolume(docker, image, nomRessource(id), `${RACINE_PROJET}/README.md`), 'modifie\n');
    await supprimerCopieControle(docker, id);
    await assert.rejects(docker.getVolume(copie).inspect());
    await supprimerCopieControle(docker, id);
  } finally {
    await supprimerCopieControle(docker, id).catch(() => {});
    await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
  }
});

test('copie de contrôle : tâche sans espace, rien n’est créé', async () => {
  const id = `T-SANS-${Date.now()}`;
  try {
    await assert.rejects(preparerCopieControle(docker, image, id), /espace de la tâche absent/);
    await assert.rejects(docker.getVolume(nomCopie(id)).inspect());
    await assert.rejects(docker.getVolume(nomRessource(id)).inspect());
  } finally {
    await supprimerCopieControle(docker, id).catch(() => {});
    await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
  }
});

/** Conteneur jetable durci, sans réseau : renvoie stdout et stderr du script. */
async function executerDansImage(imageId: string, script: string, tmpfs: Record<string, string> = {}): Promise<string> {
  const c = await docker.createContainer({
    Image: imageId, User: 'node', Cmd: ['bash', '-c', script],
    HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], NetworkMode: 'none', Tmpfs: { '/tmp': 'rw', ...tmpfs } },
  });
  try {
    await c.start();
    await c.wait();
    const { stdout, stderr } = demultiplexer((await c.logs({ stdout: true, stderr: true, follow: false })) as unknown as Buffer);
    return stdout.toString('utf8') + stderr.toString('utf8');
  } finally {
    await c.remove({ force: true }).catch(() => {});
  }
}

test('image d’analyse : outils présents et script installé', async () => {
  // HOME inscriptible : Semgrep y écrit ses réglages, la racine est en lecture seule.
  const sortie = await executerDansImage(image, 'export HOME=/tmp && dotnet --list-sdks && semgrep --version && gitleaks version && chromium --version && test -x /opt/analyse/analyser.sh && test -f /opt/analyse/semgrep-regles.yml && echo OUTILS-OK');
  assert.match(sortie, /OUTILS-OK/);
});

test('script d’analyse : base vérifiée, constats que le dépôt ne peut pas masquer, aucun secret recopié', async () => {
  const sortie = await executerDansImage(image, String.raw`
    set -e
    export HOME=/tmp
    mkdir -p /workspace/projet && cd /workspace/projet
    git init -q && git config user.email t@t && git config user.name t
    echo base > README.md && echo ancien > supprime.txt && git add . && git commit -qm base
    BASE=$(git rev-parse HEAD)
    # Le dépôt tente de masquer ses constats : nosemgrep, .semgrepignore, gitleaks:allow, .gitleaks.toml, .gitleaksignore.
    printf 'using System;
using System.Text.RegularExpressions;
public static class Motifs {
  public static Regex Creer(string m) => new Regex(m, RegexOptions.None, TimeSpan.InfiniteMatchTimeout); // nosemgrep
}
' > ./-Motifs.cs
    printf '*.cs
' > .semgrepignore
    mkdir config && printf 'aws_access_key_id = AKIAQ3EGRT7NMZ5WXPLA # gitleaks:allow
' > config/aws.env
    printf '[allowlist]
paths = ["config/"]
' > .gitleaks.toml
    git rm -q supprime.txt && git add . && git commit -qm fuite
    echo "$(git rev-parse HEAD):config/aws.env:aws-access-token:1" > .gitleaksignore && git add . && git commit -qm ignore
    set +e
    /opt/analyse/analyser.sh "$BASE"; echo "CODE=$?"
    cd /workspace/analyse
    echo "SHA-OK=$([ "$(cat sha)" = "$(git -C /workspace/projet rev-parse HEAD)" ] && echo oui)"
    echo "MODIFIES=$(sort fichiers-modifies | tr '
' ' ')"
    echo "NA=$(ls *.na | sort | tr '
' ' ')"
    for o in semgrep gitleaks; do echo "$o.code=$(cat $o.code)"; done
    node -e 'const r=JSON.parse(require("fs").readFileSync("semgrep.json","utf8")).results; console.log("SEMGREP=" + r.map(x => x.path + ":" + x.check_id.split(".").pop()).join(","))'
    node -e 'const r=JSON.parse(require("fs").readFileSync("gitleaks.json","utf8")); console.log("GITLEAKS=" + r.map(x => x.File + ":" + x.RuleID + ":" + x.StartLine).join(","))'
    echo "FUITE=$(grep -l AKIAQ3EGRT7NMZ5WXPLA gitleaks.json gitleaks.log semgrep.json 2>/dev/null | tr '
' ' ')"
    /opt/analyse/analyser.sh 0123456789abcdef0123456789abcdef01234567; echo "BASE-ABSENTE=$? $(ls /workspace/analyse | wc -l)"
    /opt/analyse/analyser.sh 'HEAD~1'; echo "BASE-INVALIDE=$? $(ls /workspace/analyse | wc -l)"
  `, { '/workspace': 'rw,exec,uid=1000,gid=1000,size=256m' });
  const ligne = (cle: string) => sortie.match(new RegExp(`^${cle}=(.*)$`, 'm'))?.[1]?.trim();
  assert.equal(ligne('CODE'), '0', sortie);
  assert.equal(ligne('SHA-OK'), 'oui', sortie);
  assert.equal(ligne('MODIFIES'), '-Motifs.cs .gitleaks.toml .gitleaksignore .semgrepignore config/aws.env', 'fichiers supprimés exclus');
  assert.equal(ligne('NA'), 'audit_dotnet.na audit_npm.na tests_angular.na tests_dotnet.na');
  assert.equal(ligne('semgrep.code'), '0', sortie);
  assert.equal(ligne('gitleaks.code'), '0', sortie);
  assert.equal(ligne('SEMGREP'), '-Motifs.cs:regular-expression-dos-infinite-timeout', 'nosemgrep et .semgrepignore sans effet');
  assert.equal(ligne('GITLEAKS'), 'config/aws.env:aws-access-token:1', 'gitleaks:allow, .gitleaks.toml et .gitleaksignore sans effet');
  assert.equal(ligne('FUITE'), '', 'aucune valeur de secret dans les rapports');
  assert.equal(ligne('BASE-ABSENTE'), '3 0', 'base absente : arrêt, aucun résultat');
  assert.equal(ligne('BASE-INVALIDE'), '3 0', 'base non hexadécimale : arrêt, aucun résultat');
});
