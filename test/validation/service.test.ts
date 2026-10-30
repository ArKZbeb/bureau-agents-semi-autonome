import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ouvrirBase, type Base } from '../../src/db.ts';
import { enregistrerArtefact } from '../../src/integrite/artefacts.ts';
import { lireJournal, verifierJournal, ajouterAuJournal } from '../../src/integrite/journal.ts';
import type { LectureValidation } from '../../src/conteneurs/validation.ts';
import { appliquer, creerTache, definirCommitBase, lireTache } from '../../src/taches/depot.ts';
import type { Executer } from '../../src/validation/depot-hote.ts';
import { dossierValidation, historique, ouvrirPullRequest, recupererBranche, type DepsValidation } from '../../src/validation/service.ts';

const cle = Buffer.alloc(32, 7);
const S = 'a'.repeat(40);
const B = 'b'.repeat(40);
const AUTRE = 'c'.repeat(40);
const BUNDLE = Buffer.from('# v2 git bundle\nfaux contenu\n');
const CRITERES = '1. Les lignes ajoutées sont en vert\n2. Les remises sont comparées\n';

const verdict = (v: 'go' | 'no_go', remplis: boolean[]) => JSON.stringify({
  qa: { verdict: v, criteres: remplis.map((rempli, i) => ({ numero: i + 1, rempli, preuve: `preuve ${i + 1}` })) },
  regles: remplis.flatMap((r, i) => (r ? [] : [`critère ${i + 1} non rempli`])),
  verdict: v,
});

function tache(): Base {
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: 'T-43', projet: 'Addiff', titre: 'Comparer deux versions d’un devis', cheminProjet: '/depots/addiff', budgetUsd: 6 });
  definirCommitBase(db, 'T-43', B);
  enregistrerArtefact(db, cle, 'T-43', 'spec', '# Spec\n');
  enregistrerArtefact(db, cle, 'T-43', 'criteres', CRITERES);
  enregistrerArtefact(db, cle, 'T-43', 'plan', '# Plan\n');
  enregistrerArtefact(db, cle, 'T-43', 'analyse', JSON.stringify({ sha: S, base: B, outils: {} }));
  enregistrerArtefact(db, cle, 'T-43', 'verdict', verdict('go', [true, true]));
  db.prepare(`UPDATE taches SET etape = 'validation', statut = 'attente_humain', raison = 'en attente de ma validation' WHERE id = 'T-43'`).run();
  return db;
}

const lecture = (pointe = S): LectureValidation => ({
  pointe, commits: 2, fichiers: [{ fichier: 'src/devis.ts', ajouts: 12, suppressions: 3 }], diff: 'diff --git a/src/devis.ts b/src/devis.ts\n', tronque: false,
});

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });

// Faux dépôt de l'hôte : simule git (réf de la branche, bundle reçu) et gh.
function fauxDepot(o: { gh?: 'ok' | 'echec' } = {}) {
  const etat = { ref: null as string | null, bundles: [] as Buffer[], fetchs: [] as string[], appels: [] as string[][] };
  const executer: Executer = async (commande, args) => {
    etat.appels.push([commande, ...args]);
    if (commande === 'gh') return o.gh === 'echec' ? { code: 1, stdout: '', stderr: 'gh: authentification requise' } : ok('https://github.com/moi/addiff/pull/7\n');
    const a = args.slice(2); // après « -C <dépôt> »
    if (a[0] === 'rev-parse' && a[1] === '--git-dir') return ok('.git\n');
    if (a[0] === 'rev-parse') return etat.ref ? ok(`${etat.ref}\n`) : { code: 1, stdout: '', stderr: '' };
    if (a[0] === 'bundle') { etat.bundles.push(fs.readFileSync(a[2])); return ok(); }
    if (a.includes('fetch')) { etat.fetchs.push(a.at(-1)!); etat.ref = S; return ok(); }
    if (a[0] === 'remote') return ok('git@github.com:moi/addiff.git\n');
    if (a[0] === 'push') return ok();
    throw new Error(`commande inattendue : ${a.join(' ')}`);
  };
  return { etat, executer };
}

function deps(db: Base, o: { pointe?: string; lecture?: LectureValidation | null; bundle?: Buffer | null; gh?: 'ok' | 'echec' } = {}) {
  const depot = fauxDepot({ gh: o.gh });
  const appels = { lire: [] as string[][], bundle: [] as string[][], supprimer: [] as string[] };
  const d: DepsValidation = {
    db, cle, executer: depot.executer,
    lire: async (volume, base, sha) => { appels.lire.push([volume, base, sha]); return o.lecture === undefined ? lecture(o.pointe) : o.lecture; },
    bundle: async (volume, tacheId, base, sha) => { appels.bundle.push([volume, tacheId, base, sha]); return o.bundle === undefined ? BUNDLE : o.bundle; },
    supprimerVolumes: async id => { appels.supprimer.push(id); },
  };
  return { d, appels, depot };
}

test('dossier : pointe = sha signé, intégrité vérifiée, lecture recopiée, compteurs du journal', async () => {
  const db = tache();
  const j = (decision: string, type: 'decision' | 'evenement' = 'decision') =>
    ajouterAuJournal(db, cle, { tacheId: 'T-43', type, commande: 'dotnet test', couche: '2', decision, decideur: 'Gardien', raison: 'x' });
  j('Autorisé'); j('Autorisé'); j('Refusé'); j('Refusé', 'evenement');
  ajouterAuJournal(db, cle, { tacheId: 'T-44', type: 'decision', commande: 'ls', couche: '2', decision: 'Refusé', decideur: 'Gardien', raison: 'x' });
  db.prepare(`INSERT INTO escalades (tache_id, outil, entree, empreinte_appel, raison, statut, cree_le) VALUES ('T-43', 'Bash', '{}', 'e', 'r', 'approuvee', 'now')`).run();
  const { d, appels } = deps(db);
  const dossier = await dossierValidation(d, 'T-43');
  assert.deepEqual(appels.lire, [['bureau-t-43', B, S]]);
  assert.deepEqual(dossier, {
    branche: 'task/43', sha: S, commits: 2, fichiers: [{ fichier: 'src/devis.ts', ajouts: 12, suppressions: 3 }],
    diff: 'diff --git a/src/devis.ts b/src/devis.ts\n', tronque: false, integrite: { verifiee: true },
    journal: { commandes: 3, refus: 1, escalades: 1 },
  });
});

test('dossier : tâche qui n’attend pas ma validation refusée', async () => {
  const db = tache();
  db.prepare(`UPDATE taches SET etape = 'qa', statut = 'prete' WHERE id = 'T-43'`).run();
  await assert.rejects(dossierValidation(deps(db).d, 'T-43'), /T-43 n’attend pas ma validation/);
});

test('dossier : lecture impossible -> erreur', async () => {
  const db = tache();
  await assert.rejects(dossierValidation(deps(db, { lecture: null }).d, 'T-43'), /lecture de la branche impossible/);
});

test('dossier : pointe différente -> non vérifiée, deux SHA courts, journal « Refusé »', async () => {
  const db = tache();
  const dossier = await dossierValidation(deps(db, { pointe: AUTRE }).d, 'T-43');
  assert.deepEqual(dossier.integrite, { verifiee: false, raison: 'la branche a changé depuis l’analyse (pointe ccccccc au lieu de aaaaaaa)' });
  const e = lireJournal(db, 'T-43').at(-1)!;
  assert.deepEqual([e.decision, e.decideur, e.commande], ['Refusé', 'Contrôleur d’intégrité', 'contrôle de la branche avant validation']);
  verifierJournal(db, cle);
});

test('dossier : artefact altéré en base -> non vérifiée avec le message de l’anomalie', async () => {
  const db = tache();
  db.prepare(`UPDATE artefacts SET contenu = 'spec réécrite' WHERE tache_id = 'T-43' AND type = 'spec'`).run();
  const dossier = await dossierValidation(deps(db).d, 'T-43');
  assert.equal(dossier.integrite.verifiee, false);
  assert.match((dossier.integrite as { raison: string }).raison, /spec de T-43 modifié après validation/);
});

test('récupération : bundle importé dans task/43, tâche terminée, volumes supprimés, journal « Autorisé »', async () => {
  const db = tache();
  const { d, appels, depot } = deps(db);
  const t = await recupererBranche(d, 'T-43');
  assert.equal(t.statut, 'terminee');
  assert.deepEqual(appels.bundle, [['bureau-t-43', 'T-43', B, S]]);
  assert.deepEqual(depot.etat.bundles, [BUNDLE]);
  assert.deepEqual(depot.etat.fetchs, ['refs/heads/task/43:refs/heads/task/43']);
  assert.ok(depot.etat.appels.every(a => a[0] === 'git' && a[1] === '-C' && a[2] === '/depots/addiff'));
  assert.deepEqual(appels.supprimer, ['T-43']);
  const e = lireJournal(db, 'T-43').at(-1)!;
  assert.deepEqual([e.decision, e.decideur, e.commande], ['Autorisé', 'Moi', 'git fetch <bundle> task/43 → /depots/addiff']);
  verifierJournal(db, cle);
});

test('récupération : pointe différente -> refus, tâche en validation, ni bundle ni suppression', async () => {
  const db = tache();
  const { d, appels, depot } = deps(db, { pointe: AUTRE });
  await assert.rejects(recupererBranche(d, 'T-43'), /récupération refusée : la branche a changé depuis l’analyse/);
  assert.deepEqual([lireTache(db, 'T-43').etape, lireTache(db, 'T-43').statut], ['validation', 'attente_humain']);
  assert.deepEqual(appels.bundle, []);
  assert.deepEqual(appels.supprimer, []);
  assert.deepEqual(depot.etat.appels, []);
  assert.equal(lireJournal(db, 'T-43').at(-1)!.decision, 'Refusé');
});

test('récupération : artefact altéré -> refus, rien importé', async () => {
  const db = tache();
  db.prepare(`UPDATE artefacts SET contenu = '1. tout est rempli\n' WHERE tache_id = 'T-43' AND type = 'criteres'`).run();
  const { d, appels, depot } = deps(db);
  await assert.rejects(recupererBranche(d, 'T-43'), /récupération refusée : criteres de T-43 modifié/);
  assert.deepEqual([appels.bundle, appels.supprimer, depot.etat.appels], [[], [], []]);
  assert.equal(lireTache(db, 'T-43').statut, 'attente_humain');
});

test('récupération : bundle impossible -> erreur, tâche inchangée, journal « Refusé »', async () => {
  const db = tache();
  const { d, appels, depot } = deps(db, { bundle: null });
  await assert.rejects(recupererBranche(d, 'T-43'), /bundle de la branche impossible \(pointe changée, branche vide ou trop volumineuse\)/);
  assert.equal(lireTache(db, 'T-43').statut, 'attente_humain');
  assert.deepEqual([appels.supprimer, depot.etat.appels], [[], []]);
  assert.equal(lireJournal(db, 'T-43').at(-1)!.decision, 'Refusé');
});

test('récupération : import refusé par le dépôt -> erreur journalisée, tâche inchangée', async () => {
  const db = tache();
  const { d, appels, depot } = deps(db);
  depot.etat.ref = AUTRE; // task/43 existe déjà sur un autre commit
  await assert.rejects(recupererBranche(d, 'T-43'), /existe déjà dans ton dépôt sur un autre commit/);
  assert.equal(lireTache(db, 'T-43').statut, 'attente_humain');
  assert.deepEqual(appels.supprimer, []);
  const e = lireJournal(db, 'T-43').at(-1)!;
  assert.equal(e.decision, 'Refusé');
  assert.match(e.raison, /existe déjà/);
});

test('récupération : échec de suppression des volumes journalisé, tâche terminée quand même', async () => {
  const db = tache();
  const { d } = deps(db);
  d.supprimerVolumes = async () => { throw new Error('volume occupé'); };
  assert.equal((await recupererBranche(d, 'T-43')).statut, 'terminee');
  assert.match(lireJournal(db, 'T-43').at(-1)!.raison, /volume occupé/);
});

test('PR : gh réussit -> tâche terminée, URL rendue, corps avec critères et verdict', async () => {
  const db = tache();
  const { d, appels, depot } = deps(db);
  const r = await ouvrirPullRequest(d, 'T-43');
  assert.equal(r.url, 'https://github.com/moi/addiff/pull/7');
  assert.equal(r.tache.statut, 'terminee');
  const gh = depot.etat.appels.find(a => a[0] === 'gh')!;
  assert.deepEqual(gh.slice(0, 7), ['gh', 'pr', 'create', '--head', 'task/43', '--title', 'T-43 · Comparer deux versions d’un devis']);
  assert.equal(gh[8], `## Critères d'acceptation\n\n${CRITERES.trim()}\n\n## Verdict QA\n\nGO, 2 critères remplis sur 2`);
  assert.deepEqual(appels.supprimer, ['T-43']);
  const e = lireJournal(db, 'T-43').at(-1)!;
  assert.deepEqual([e.decision, e.decideur, e.commande, e.raison], ['Autorisé', 'Moi', 'gh pr create', 'https://github.com/moi/addiff/pull/7']);
  verifierJournal(db, cle);
});

test('PR : gh échoue -> branche récupérée, tâche en validation, volumes conservés ; nouvel essai possible', async () => {
  const db = tache();
  const { d, appels, depot } = deps(db, { gh: 'echec' });
  await assert.rejects(ouvrirPullRequest(d, 'T-43'), /branche récupérée dans ton dépôt ; PR impossible : gh pr create a échoué/);
  assert.deepEqual([lireTache(db, 'T-43').etape, lireTache(db, 'T-43').statut], ['validation', 'attente_humain']);
  assert.equal(depot.etat.ref, S);
  assert.deepEqual(appels.supprimer, []);
  assert.equal(lireJournal(db, 'T-43').at(-1)!.decision, 'Refusé');
  // Second choix : récupérer la branche, déjà présente (import idempotent).
  assert.equal((await recupererBranche(d, 'T-43')).statut, 'terminee');
  assert.equal(depot.etat.fetchs.length, 1);
});

test('PR : NO-GO signé rendu tel quel dans le corps', async () => {
  const db = tache();
  enregistrerArtefact(db, cle, 'T-43', 'verdict', verdict('no_go', [true, false]));
  const { d, depot } = deps(db);
  await ouvrirPullRequest(d, 'T-43');
  assert.match(depot.etat.appels.find(a => a[0] === 'gh')![8], /NO-GO, 1 critères remplis sur 2$/);
});

test('historique : versions du verdict, la plus récente d’abord, critères non remplis extraits', () => {
  const db = tache();
  enregistrerArtefact(db, cle, 'T-43', 'verdict', verdict('no_go', [false, true]));
  enregistrerArtefact(db, cle, 'T-43', 'verdict', verdict('no_go', [true, false]));
  const h = historique(deps(db).d, 'T-43');
  assert.equal(h.length, 3);
  assert.deepEqual(h.map(v => v.verdict), ['no_go', 'no_go', 'go']);
  assert.deepEqual(h[0].criteresNonRemplis, [{ numero: 2, preuve: 'preuve 2' }]);
  assert.deepEqual(h[0].regles, ['critère 2 non rempli']);
  assert.deepEqual(h[1].criteresNonRemplis, [{ numero: 1, preuve: 'preuve 1' }]);
  assert.deepEqual(h[2].criteresNonRemplis, []);
  assert.ok(h.every(v => typeof v.creeLe === 'string'));
});

test('états hors validation refusés pour la récupération et la PR', async () => {
  const db = tache();
  appliquer(db, 'T-43', { type: 'validation', decision: 'branche' });
  const { d, appels } = deps(db);
  await assert.rejects(recupererBranche(d, 'T-43'), /n’attend pas ma validation/);
  await assert.rejects(ouvrirPullRequest(d, 'T-43'), /n’attend pas ma validation/);
  assert.deepEqual(appels.lire, []);
});
