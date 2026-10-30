import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../../src/db.ts';
import { definirSeuils, lireSeuils } from '../../src/taches/seuils.ts';

test('seuil par défaut, puis propre au projet', () => {
  const db = ouvrirBase(':memory:');
  assert.deepEqual(lireSeuils(db, 'Film', 80), { couvertureLignes: 80 });
  definirSeuils(db, 'Film', { couvertureLignes: 90 });
  assert.deepEqual(lireSeuils(db, 'Film', 80), { couvertureLignes: 90 });
  assert.deepEqual(lireSeuils(db, 'Addiff', 80), { couvertureLignes: 80 });
});

test('seuil hors bornes refusé', () => {
  const db = ouvrirBase(':memory:');
  for (const v of [-1, 101, 1.5, Number.NaN]) assert.throws(() => definirSeuils(db, 'Film', { couvertureLignes: v }));
});
