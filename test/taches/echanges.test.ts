import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../../src/db.ts';
import { ajouterEchange, enregistrerProposition, listerEchanges, lireProposition, supprimerProposition } from '../../src/taches/echanges.ts';

test('échanges dans l’ordre, par tâche', () => {
  const db = ouvrirBase(':memory:');
  ajouterEchange(db, 'T-43', 'cadreur', 'Le devis comparé garde-t-il les remises ?');
  ajouterEchange(db, 'T-43', 'moi', 'Oui, ligne à ligne.');
  ajouterEchange(db, 'T-44', 'moi', 'autre tâche');
  assert.deepEqual(listerEchanges(db, 'T-43').map(e => [e.auteur, e.texte]), [
    ['cadreur', 'Le devis comparé garde-t-il les remises ?'], ['moi', 'Oui, ligne à ligne.'],
  ]);
});

test('proposition remplacée puis supprimée', () => {
  const db = ouvrirBase(':memory:');
  assert.equal(lireProposition(db, 'T-43'), null);
  enregistrerProposition(db, 'T-43', { spec: 'v1', criteres: ['c1'], plan: 'p1' });
  enregistrerProposition(db, 'T-43', { spec: 'v2', criteres: ['c1', 'c2'], plan: 'p2' });
  assert.deepEqual(lireProposition(db, 'T-43'), { spec: 'v2', criteres: ['c1', 'c2'], plan: 'p2' });
  supprimerProposition(db, 'T-43');
  assert.equal(lireProposition(db, 'T-43'), null);
});
