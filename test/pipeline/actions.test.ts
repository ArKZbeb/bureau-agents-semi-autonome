import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../../src/db.ts';
import { lireArtefact } from '../../src/integrite/artefacts.ts';
import { lireJournal, verifierJournal } from '../../src/integrite/journal.ts';
import { arbitrer, continuerBudget, repondreCadreur, reprendre, validerCadrage } from '../../src/pipeline/actions.ts';
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
