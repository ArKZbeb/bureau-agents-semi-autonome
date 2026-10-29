import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerConfig } from '../src/config.ts';

test('valeurs par défaut sûres', () => {
  const c = chargerConfig({ LOCALAPPDATA: 'C:/Users/x/AppData/Local' });
  assert.equal(c.portUi, 4310);
  assert.equal(c.portConteneurs, 4311);
  assert.equal(c.urlApiAmont, 'https://api.anthropic.com');
  assert.equal(c.modeleGardien, 'claude-haiku-5-5');
  assert.equal(c.cleApi, undefined);
  assert.deepEqual(c.domainesAutorises, ['registry.npmjs.org', 'api.nuget.org', 'nuget.org']);
  assert.match(c.dossierDonnees.replaceAll('\\', '/'), /AppData\/Local\/bureau-agents$/);
});

test('surcharges par variables d’environnement', () => {
  const c = chargerConfig({ BUREAU_DONNEES: '/tmp/b', BUREAU_PORT_UI: '5000', BUREAU_PORT_CONTENEURS: '5001', BUREAU_URL_API: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: 'k' });
  assert.equal(c.dossierDonnees, '/tmp/b');
  assert.equal(c.portUi, 5000);
  assert.equal(c.portConteneurs, 5001);
  assert.equal(c.urlApiAmont, 'http://127.0.0.1:9');
  assert.equal(c.cleApi, 'k');
});

test('modèles par agent : valeurs de la maquette, surcharge par variable', () => {
  const c = chargerConfig({});
  assert.deepEqual(c.modeles, {
    cadreur: 'claude-opus-5-5', patron: 'claude-opus-5-5', implementeur: 'claude-sonnet-5-5',
    reviewer: 'claude-sonnet-5-5', qa: 'claude-opus-5-5', controleur: 'claude-haiku-5-5',
  });
  assert.equal(c.tachesSimultanees, 2);
  assert.equal(chargerConfig({ BUREAU_MODELE_QA: 'claude-sonnet-5-5' }).modeles.qa, 'claude-sonnet-5-5');
});
