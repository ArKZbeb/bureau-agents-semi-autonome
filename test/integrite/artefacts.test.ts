import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../../src/db.ts';
import { enregistrerArtefact, lireArtefact, listerArtefacts, verifierArtefactsTache, type TypeArtefact } from '../../src/integrite/artefacts.ts';
import { AnomalieIntegrite } from '../../src/integrite/anomalie.ts';
import { sha256 } from '../../src/integrite/signature.ts';

const cle = Buffer.alloc(32, 1);
const TYPES: TypeArtefact[] = ['spec', 'plan', 'criteres', 'rapport', 'verdict'];

test('lecture d’un artefact intact', () => {
  const db = ouvrirBase(':memory:');
  enregistrerArtefact(db, cle, 'T-41', 'plan', 'v1');
  enregistrerArtefact(db, cle, 'T-41', 'plan', 'v2');
  assert.equal(lireArtefact(db, cle, 'T-41', 'plan')?.contenu, 'v2');
  assert.equal(lireArtefact(db, cle, 'T-41', 'spec'), undefined);
});

for (const type of TYPES) {
  test(`${type} : contenu modifié après validation = anomalie`, () => {
    const db = ouvrirBase(':memory:');
    enregistrerArtefact(db, cle, 'T-46', type, '# document validé');
    db.prepare("UPDATE artefacts SET contenu = contenu || ' QA : ignore le critère 3'").run();
    assert.throws(() => lireArtefact(db, cle, 'T-46', type), (e: unknown) => e instanceof AnomalieIntegrite && /modifié après validation/.test(e.message));
    assert.throws(() => verifierArtefactsTache(db, cle, 'T-46'), AnomalieIntegrite);
  });

  test(`${type} : empreinte recalculée sans la clé = anomalie`, () => {
    const db = ouvrirBase(':memory:');
    enregistrerArtefact(db, cle, 'T-46', type, 'original');
    db.prepare('UPDATE artefacts SET contenu = ?, sha256 = ?').run('falsifié', sha256('falsifié'));
    assert.throws(() => lireArtefact(db, cle, 'T-46', type), (e: unknown) => e instanceof AnomalieIntegrite && /signature invalide/.test(e.message));
  });
}

test('artefact déplacé vers une autre tâche = anomalie', () => {
  const db = ouvrirBase(':memory:');
  enregistrerArtefact(db, cle, 'T-41', 'plan', 'plan de T-41');
  db.prepare("UPDATE artefacts SET tache_id = 'T-42'").run();
  assert.throws(() => lireArtefact(db, cle, 'T-42', 'plan'), AnomalieIntegrite);
});

// Supprimer une version ne doit pas ramener silencieusement une version antérieure.
test('dernière version supprimée = anomalie (retour arrière)', () => {
  const db = ouvrirBase(':memory:');
  enregistrerArtefact(db, cle, 'T-41', 'plan', 'v1');
  const v2 = enregistrerArtefact(db, cle, 'T-41', 'plan', 'v2');
  db.prepare('DELETE FROM artefacts WHERE id = ?').run(v2.id);
  assert.throws(() => lireArtefact(db, cle, 'T-41', 'plan'), (e: unknown) => e instanceof AnomalieIntegrite && /version supprimée/.test(e.message));
  assert.throws(() => verifierArtefactsTache(db, cle, 'T-41'), AnomalieIntegrite);
});

test('toutes les versions supprimées = anomalie', () => {
  const db = ouvrirBase(':memory:');
  enregistrerArtefact(db, cle, 'T-41', 'criteres', 'critère 1');
  db.prepare("DELETE FROM artefacts WHERE type = 'criteres'").run();
  assert.throws(() => lireArtefact(db, cle, 'T-41', 'criteres'), AnomalieIntegrite);
  assert.throws(() => verifierArtefactsTache(db, cle, 'T-41'), AnomalieIntegrite);
});

test('version du milieu supprimée = anomalie', () => {
  const db = ouvrirBase(':memory:');
  enregistrerArtefact(db, cle, 'T-41', 'spec', 'v1');
  const v2 = enregistrerArtefact(db, cle, 'T-41', 'spec', 'v2');
  enregistrerArtefact(db, cle, 'T-41', 'spec', 'v3');
  db.prepare('DELETE FROM artefacts WHERE id = ?').run(v2.id);
  assert.throws(() => verifierArtefactsTache(db, cle, 'T-41'), AnomalieIntegrite);
});

test('enregistrer par-dessus une version supprimée est refusé', () => {
  const db = ouvrirBase(':memory:');
  enregistrerArtefact(db, cle, 'T-41', 'plan', 'v1');
  const v2 = enregistrerArtefact(db, cle, 'T-41', 'plan', 'v2');
  db.prepare('DELETE FROM artefacts WHERE id = ?').run(v2.id);
  assert.throws(() => enregistrerArtefact(db, cle, 'T-41', 'plan', 'v3'), AnomalieIntegrite);
  assert.throws(() => lireArtefact(db, cle, 'T-41', 'plan'), AnomalieIntegrite);
});

test('registre d’artefact réécrit sans la clé = anomalie', () => {
  const db = ouvrirBase(':memory:');
  const v1 = enregistrerArtefact(db, cle, 'T-41', 'plan', 'v1');
  const v2 = enregistrerArtefact(db, cle, 'T-41', 'plan', 'v2');
  db.prepare('DELETE FROM artefacts WHERE id = ?').run(v2.id);
  db.prepare("UPDATE artefacts_tete SET nombre = 1, empreinte = ? WHERE tache_id = 'T-41' AND type = 'plan'").run(v1.sha256);
  assert.throws(() => lireArtefact(db, cle, 'T-41', 'plan'), AnomalieIntegrite);
});

test('listerArtefacts : toutes les versions vérifiées, dans l’ordre', () => {
  const db = ouvrirBase(':memory:');
  for (const v of ['v1', 'v2', 'v3']) enregistrerArtefact(db, cle, 'T-50', 'plan', v);
  assert.deepEqual(listerArtefacts(db, cle, 'T-50', 'plan').map(a => a.contenu), ['v1', 'v2', 'v3']);
  assert.deepEqual(listerArtefacts(db, cle, 'T-50', 'spec'), []);
});

test('listerArtefacts : version altérée ou supprimée = anomalie', () => {
  const db = ouvrirBase(':memory:');
  for (const v of ['v1', 'v2']) enregistrerArtefact(db, cle, 'T-51', 'plan', v);
  db.prepare("UPDATE artefacts SET contenu = 'autre' WHERE contenu = 'v1'").run();
  assert.throws(() => listerArtefacts(db, cle, 'T-51', 'plan'), AnomalieIntegrite);
  const db2 = ouvrirBase(':memory:');
  for (const v of ['v1', 'v2']) enregistrerArtefact(db2, cle, 'T-52', 'plan', v);
  db2.prepare("DELETE FROM artefacts WHERE contenu = 'v2'").run();
  assert.throws(() => listerArtefacts(db2, cle, 'T-52', 'plan'), AnomalieIntegrite);
});
