import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../../src/db.ts';
import { lireArtefact } from '../../src/integrite/artefacts.ts';
import { lireJournal, verifierJournal } from '../../src/integrite/journal.ts';
import { abandonner, arbitrer, continuerBudget, journaliserRepriseGlobale, pauserPourArretGlobal, relancer, renvoyer, repondreCadreur, reprendre, validerCadrage } from '../../src/pipeline/actions.ts';
import { appliquer, creerTache, lireTache } from '../../src/taches/depot.ts';
import { enregistrerProposition, listerEchanges, lireProposition } from '../../src/taches/echanges.ts';

const cle = Buffer.alloc(32, 12);
const PLAN = '# Plan\n\n## Zones touchées\n\n- `src/**`\n';

function tache() {
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: 'T-43', projet: 'Addiff', titre: 'Comparer deux versions d’un devis', cheminProjet: '/p', budgetUsd: 6 });
  appliquer(db, 'T-43', { type: 'demarrage' });
  return db;
}

test('répondre au cadreur : échange gardé, cadrage relancé', () => {
  const db = tache();
  appliquer(db, 'T-43', { type: 'etape_terminee', verdict: 'questions' });
  const t = repondreCadreur(db, cle, 'T-43', 'Oui, ligne à ligne, remises comprises.');
  assert.deepEqual([t.etape, t.statut], ['cadrage', 'prete']);
  assert.deepEqual({ ...listerEchanges(db, 'T-43').at(-1) }, { auteur: 'moi', texte: 'Oui, ligne à ligne, remises comprises.', creeLe: listerEchanges(db, 'T-43').at(-1)!.creeLe });
  assert.equal(lireJournal(db, 'T-43').at(-1)?.decideur, 'Moi');
});

test('valider le cadrage : documents signés, critères numérotés, proposition effacée', () => {
  const db = tache();
  enregistrerProposition(db, 'T-43', { spec: '# Spec', criteres: ['Les lignes ajoutées sont en vert', 'Les remises sont comparées'], plan: PLAN });
  appliquer(db, 'T-43', { type: 'etape_terminee', verdict: 'proposition' });
  const t = validerCadrage(db, cle, 'T-43');
  assert.deepEqual([t.etape, t.statut], ['patron_plan', 'prete']);
  assert.equal(lireArtefact(db, cle, 'T-43', 'criteres')?.contenu, '1. Les lignes ajoutées sont en vert\n2. Les remises sont comparées\n');
  assert.equal(lireArtefact(db, cle, 'T-43', 'plan')?.contenu, PLAN);
  assert.equal(lireProposition(db, 'T-43'), null);
  verifierJournal(db, cle);
});

test('valider sans proposition ou hors attente : refus explicite', () => {
  const db = tache();
  assert.throws(() => validerCadrage(db, cle, 'T-43'), /aucune proposition/);
  appliquer(db, 'T-43', { type: 'etape_terminee', verdict: 'questions' });
  enregistrerProposition(db, 'T-43', { spec: 's', criteres: ['c'], plan: PLAN });
  assert.throws(() => validerCadrage(db, cle, 'T-43'));
  assert.equal(lireArtefact(db, cle, 'T-43', 'spec'), undefined, 'rien de signé après un refus');
});

test('budget : seulement sur une pause budget, montant positif', () => {
  const db = tache();
  assert.throws(() => continuerBudget(db, cle, 'T-43', 2), /pause budget/);
  appliquer(db, 'T-43', { type: 'pause', raison: 'budget', detail: 'Budget dépassé : 6.10 $ / 6.00 $' });
  assert.throws(() => continuerBudget(db, cle, 'T-43', 0), /montant/);
  const t = continuerBudget(db, cle, 'T-43', 2);
  assert.deepEqual([t.statut, t.budgetUsd], ['prete', 8]);
});

test('reprendre : intégrité, arrêt global, erreur API et blocage ; jamais une escalade ni un budget', () => {
  for (const raison of ['integrite', 'arret_global', 'erreur_api'] as const) {
    const db = tache();
    appliquer(db, 'T-43', { type: 'pause', raison, detail: 'x' });
    assert.equal(reprendre(db, cle, 'T-43').statut, 'prete');
  }
  for (const raison of ['escalade', 'budget'] as const) {
    const db = tache();
    appliquer(db, 'T-43', { type: 'pause', raison, detail: 'x' });
    assert.throws(() => reprendre(db, cle, 'T-43'));
  }
  const db = tache();
  appliquer(db, 'T-43', { type: 'bloquee', detail: 'étape trop longue' });
  assert.equal(reprendre(db, cle, 'T-43').statut, 'prete');
});

test('arbitrage : approche du cadreur ou alternative du patron', () => {
  const db = tache();
  db.prepare(`UPDATE taches SET etape = 'patron_plan', statut = 'attente_humain', echanges_plan = 2 WHERE id = 'T-43'`).run();
  assert.equal(arbitrer(db, cle, 'T-43', 'cadreur').etape, 'implementation');
});

test('arrêt global : tâches prêtes et en cours en pause arret_global, les autres intactes', () => {
  const db = ouvrirBase(':memory:');
  for (const id of ['T-1', 'T-2', 'T-3', 'T-4']) creerTache(db, { id, projet: 'p', titre: 't', cheminProjet: '/p', budgetUsd: 6 });
  appliquer(db, 'T-2', { type: 'demarrage' });
  appliquer(db, 'T-3', { type: 'demarrage' });
  appliquer(db, 'T-3', { type: 'etape_terminee', verdict: 'questions' });
  appliquer(db, 'T-4', { type: 'demarrage' });
  appliquer(db, 'T-4', { type: 'pause', raison: 'budget', detail: 'x' });
  assert.deepEqual(pauserPourArretGlobal(db), ['T-1', 'T-2']);
  assert.deepEqual(['T-1', 'T-2', 'T-3', 'T-4'].map(id => lireTache(db, id).raison), [
    'arret_global : arrêt global demandé', 'arret_global : arrêt global demandé', 'le cadreur attend ta réponse', 'budget : x',
  ]);
});

test('reprise globale : décision « Moi » journalisée, tâches toujours en pause', () => {
  const db = tache();
  appliquer(db, 'T-43', { type: 'pause', raison: 'arret_global', detail: 'arrêt global demandé' });
  journaliserRepriseGlobale(db, cle);
  const e = lireJournal(db).at(-1)!;
  assert.deepEqual([e.tacheId, e.type, e.decideur, e.decision, e.couche, e.commande], ['—', 'decision', 'Moi', 'Autorisé', 'humain', 'reprise globale']);
  assert.equal(lireTache(db, 'T-43').statut, 'en_pause');
  verifierJournal(db, cle);
});

test('budget : montant non fini refusé', () => {
  const db = tache();
  appliquer(db, 'T-43', { type: 'pause', raison: 'budget', detail: 'x' });
  assert.throws(() => continuerBudget(db, cle, 'T-43', Infinity), /montant attendu/);
  assert.throws(() => continuerBudget(db, cle, 'T-43', NaN), /montant attendu/);
  assert.equal(lireTache(db, 'T-43').budgetUsd, 6);
});

const enValidation = (db: ReturnType<typeof tache>) => db.prepare("UPDATE taches SET etape = 'validation', statut = 'attente_humain', raison = 'en attente de ma validation', essais_qa = 2 WHERE id = 'T-43'").run();
const bloquee = (db: ReturnType<typeof tache>) => db.prepare("UPDATE taches SET etape = 'qa', statut = 'bloquee', raison = '3 no-go du QA : la tâche me revient', essais_qa = 3 WHERE id = 'T-43'").run();

test('renvoyer : retour humain signé, implémentation relancée', () => {
  const db = tache();
  enValidation(db);
  const t = renvoyer(db, cle, 'T-43', '  Ajoute le test du cas vide ');
  assert.deepEqual([t.etape, t.statut, t.essaisQa], ['implementation', 'prete', 0]);
  assert.equal(lireArtefact(db, cle, 'T-43', 'retour_humain')?.contenu, '{"vers":"implementation","texte":"Ajoute le test du cas vide"}');
  const j = lireJournal(db, 'T-43').at(-1);
  assert.deepEqual([j?.commande, j?.decideur], ['renvoi avec commentaire', 'Moi']);
  verifierJournal(db, cle);
});

test('renvoyer : commentaire vide ou tâche hors validation = refus sans signature', () => {
  const db = tache();
  enValidation(db);
  assert.throws(() => renvoyer(db, cle, 'T-43', '   '), new Error('commentaire requis'));
  assert.equal(lireArtefact(db, cle, 'T-43', 'retour_humain'), undefined);
  const db2 = tache();
  assert.throws(() => renvoyer(db2, cle, 'T-43', 'ok'), /n’attend pas ma validation/);
  assert.equal(lireJournal(db2, 'T-43').length, 0);
  assert.equal(lireArtefact(db2, cle, 'T-43', 'retour_humain'), undefined);
});

test('relancer : avec ou sans commentaire, vers l’implémentation ou le cadrage', () => {
  const db = tache();
  bloquee(db);
  const t = relancer(db, cle, 'T-43', 'implementation', 'Essaie autrement');
  assert.deepEqual([t.etape, t.statut, t.essaisQa], ['implementation', 'prete', 0]);
  assert.equal(lireArtefact(db, cle, 'T-43', 'retour_humain')?.contenu, '{"vers":"implementation","texte":"Essaie autrement"}');
  assert.equal(lireJournal(db, 'T-43').at(-1)?.commande, 'relance (implémentation)');
  const db2 = tache();
  bloquee(db2);
  const t2 = relancer(db2, cle, 'T-43', 'cadrage', null);
  assert.deepEqual([t2.etape, t2.statut], ['cadrage', 'prete']);
  assert.equal(lireArtefact(db2, cle, 'T-43', 'retour_humain'), undefined);
  assert.equal(lireJournal(db2, 'T-43').at(-1)?.commande, 'relance (cadrage)');
});

test('relancer : état invalide = erreur, rien de signé', () => {
  const db = tache();
  assert.throws(() => relancer(db, cle, 'T-43', 'implementation', 'Vas-y'), /transition « relance » impossible/);
  assert.equal(lireJournal(db, 'T-43').length, 0);
  assert.equal(lireArtefact(db, cle, 'T-43', 'retour_humain'), undefined);
});

test('abandonner : depuis bloquée oui, depuis en cours non', () => {
  const db = tache();
  assert.throws(() => abandonner(db, cle, 'T-43'), /transition « abandon » impossible/);
  assert.equal(lireJournal(db, 'T-43').length, 0);
  bloquee(db);
  assert.equal(abandonner(db, cle, 'T-43').statut, 'abandonnee');
  assert.equal(lireJournal(db, 'T-43').at(-1)?.commande, 'abandon de la tâche');
});

test('relancer vers le cadrage avec commentaire, et relance après alerte d’intégrité', () => {
  const db = tache();
  bloquee(db);
  const t = relancer(db, cle, 'T-43', 'cadrage', 'Revois le périmètre');
  assert.deepEqual([t.etape, t.statut, t.essaisQa, t.echangesPlan], ['cadrage', 'prete', 0, 0]);
  assert.equal(lireArtefact(db, cle, 'T-43', 'retour_humain')?.contenu, '{"vers":"cadrage","texte":"Revois le périmètre"}');
  const db2 = tache();
  db2.prepare("UPDATE taches SET etape = 'qa', statut = 'en_pause', raison = 'integrite : la branche a changé', essais_qa = 1 WHERE id = 'T-43'").run();
  const t2 = relancer(db2, cle, 'T-43', 'implementation', null);
  assert.deepEqual([t2.etape, t2.statut, t2.essaisQa], ['implementation', 'prete', 2]);
});

test('relancer et abandonner refusent tant qu’un agent travaille ; la reprise est effacée sinon', () => {
  const db = tache();
  bloquee(db);
  db.prepare("UPDATE taches SET agent = 'implementeur' WHERE id = 'T-43'").run();
  assert.throws(() => relancer(db, cle, 'T-43', 'implementation', 'x'), /un agent travaille encore/);
  assert.throws(() => abandonner(db, cle, 'T-43'), /un agent travaille encore/);
  assert.equal(lireArtefact(db, cle, 'T-43', 'retour_humain'), undefined);
  assert.equal(lireJournal(db, 'T-43').length, 0);
  db.prepare("UPDATE taches SET agent = NULL, reprise = '{\"session\":\"s\"}' WHERE id = 'T-43'").run();
  relancer(db, cle, 'T-43', 'implementation', null);
  assert.equal(lireTache(db, 'T-43').reprise, null);
  const db2 = tache();
  bloquee(db2);
  db2.prepare("UPDATE taches SET reprise = '{\"session\":\"s\"}' WHERE id = 'T-43'").run();
  abandonner(db2, cle, 'T-43');
  assert.equal(lireTache(db2, 'T-43').reprise, null);
});
