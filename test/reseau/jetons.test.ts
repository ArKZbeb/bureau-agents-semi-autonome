import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Jetons } from '../../src/reseau/jetons.ts';

test('jeton valide, expiré, révoqué, inconnu', () => {
  let t = 1000;
  const j = new Jetons(() => t);
  const a = j.creer('T-41', 500);
  const b = j.creer('T-42', 5000);
  assert.equal(j.valider(a), 'T-41');
  assert.equal(j.valider(undefined), null);
  assert.equal(j.valider('inconnu'), null);
  t = 1600;
  assert.equal(j.valider(a), null);
  j.revoquer('T-42');
  assert.equal(j.valider(b), null);
  assert.ok(a.length >= 43, 'au moins 256 bits');
});

test('portée : « agent » par défaut, « sortie » refusée là où « agent » est exigée', () => {
  const j = new Jetons();
  const agent = j.creer('T-41', 5000);
  const sortie = j.creer('T-42', 5000, 'sortie');
  assert.equal(j.valider(agent, 'agent'), 'T-41');
  assert.equal(j.valider(sortie), 'T-42', 'sans exigence : toute portée');
  assert.equal(j.valider(sortie, 'agent'), null);
  j.revoquer('T-42');
  assert.equal(j.valider(sortie), null);
});
