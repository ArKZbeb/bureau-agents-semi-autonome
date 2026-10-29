import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ouvrirBase } from '../../src/db.ts';
import { creerTache, lireTache, listerTaches, appliquer, definirReprise, ajouterDepense, augmenterBudget, reprendreApresRedemarrage, definirAgent } from '../../src/taches/depot.ts';

const T41 = { id: 'T-41', projet: 'Film', titre: 'Export PDF de la fiche film', cheminProjet: 'C:/dev/film', budgetUsd: 6 };

test('création, lecture et transitions persistées', () => {
  const db = ouvrirBase(':memory:');
  const t = creerTache(db, T41);
  assert.deepEqual([t.etape, t.statut, t.depenseUsd, t.reprise], ['cadrage', 'prete', 0, null]);
  appliquer(db, 'T-41', { type: 'demarrage' });
  assert.equal(lireTache(db, 'T-41').statut, 'en_cours');
  assert.throws(() => lireTache(db, 'T-99'), /tâche inconnue/);
  assert.equal(listerTaches(db).length, 1);
});

test('dépense, budget et reprise', () => {
  const db = ouvrirBase(':memory:');
  creerTache(db, T41);
  ajouterDepense(db, 'T-41', 4.5);
  assert.equal(ajouterDepense(db, 'T-41', 1.5).depenseUsd, 6);
  assert.equal(augmenterBudget(db, 'T-41', 2).budgetUsd, 8);
  definirReprise(db, 'T-41', { sessionId: 's1', mode: 'defer', message: null, empreinteTranscript: 'abc' });
  assert.equal(lireTache(db, 'T-41').reprise?.sessionId, 's1');
  definirReprise(db, 'T-41', null);
  assert.equal(lireTache(db, 'T-41').reprise, null);
});

test('reprise après redémarrage : en cours → prête, pauses intactes', () => {
  const fichier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-')), 'b.sqlite');
  let db = ouvrirBase(fichier);
  for (const id of ['T-42', 'T-45', 'T-46']) creerTache(db, { ...T41, id });
  appliquer(db, 'T-42', { type: 'demarrage' });
  appliquer(db, 'T-45', { type: 'demarrage' });
  appliquer(db, 'T-46', { type: 'demarrage' });
  appliquer(db, 'T-46', { type: 'pause', raison: 'integrite', detail: 'plan.md modifié après validation' });
  db.close();

  db = ouvrirBase(fichier);
  assert.deepEqual(reprendreApresRedemarrage(db).sort(), ['T-42', 'T-45']);
  assert.equal(lireTache(db, 'T-42').statut, 'prete');
  assert.equal(lireTache(db, 'T-46').statut, 'en_pause');
  assert.match(lireTache(db, 'T-46').raison ?? '', /^integrite/);
});

test('reprise après redémarrage : la reprise de session est effacée, l’étape repart de zéro', () => {
  const db = ouvrirBase(':memory:');
  creerTache(db, T41);
  appliquer(db, 'T-41', { type: 'demarrage' });
  definirReprise(db, 'T-41', { sessionId: 's1', mode: 'message', message: 'Reprends.', empreinteTranscript: 'abc' });
  assert.deepEqual(reprendreApresRedemarrage(db), ['T-41']);
  assert.equal(lireTache(db, 'T-41').statut, 'prete');
  assert.equal(lireTache(db, 'T-41').reprise, null);
});

test('agent courant enregistré puis effacé', () => {
  const db = ouvrirBase(':memory:');
  creerTache(db, T41);
  assert.equal(lireTache(db, 'T-41').agent, null);
  definirAgent(db, 'T-41', 'reviewer');
  assert.equal(lireTache(db, 'T-41').agent, 'reviewer');
  definirAgent(db, 'T-41', null);
  assert.equal(lireTache(db, 'T-41').agent, null);
});
