import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition, TransitionInvalide, type EtatTache, type Evenement } from '../../src/taches/etats.ts';

const initial: EtatTache = { etape: 'cadrage', statut: 'prete', raison: null, echangesPlan: 0, essaisQa: 0 };
const suite = (e: EtatTache, ...evs: Evenement[]) => evs.reduce(transition, e);
const finir = (verdict?: 'ok' | 'objection' | 'go' | 'no_go'): Evenement[] => [{ type: 'demarrage' }, { type: 'etape_terminee', verdict }];

test('parcours nominal jusqu’à la validation', () => {
  const e = suite(initial, ...finir(), ...finir('ok'), ...finir(), ...finir(), ...finir(), ...finir('go'));
  assert.equal(e.etape, 'validation');
  assert.equal(e.statut, 'attente_humain');
  assert.equal(suite(e, { type: 'validation', decision: 'pr' }).statut, 'terminee');
  assert.equal(suite(e, { type: 'validation', decision: 'abandon' }).statut, 'abandonnee');
});

test('objections du patron : deux échanges puis arbitrage humain', () => {
  let e = suite(initial, ...finir(), ...finir('objection'));
  assert.deepEqual([e.etape, e.statut, e.echangesPlan], ['cadrage', 'prete', 1]);
  e = suite(e, ...finir(), ...finir('objection'));
  assert.deepEqual([e.etape, e.statut, e.echangesPlan], ['patron_plan', 'attente_humain', 2]);
  assert.equal(suite(e, { type: 'arbitrage', choix: 'cadreur' }).etape, 'implementation');
  assert.equal(suite(e, { type: 'arbitrage', choix: 'alternative' }).etape, 'cadrage');
});

test('trois no-go : la tâche me revient', () => {
  const qa: EtatTache = { ...initial, etape: 'qa' };
  let e = suite(qa, ...finir('no_go'));
  assert.deepEqual([e.etape, e.essaisQa], ['implementation', 1]);
  e = suite({ ...e, etape: 'qa' }, ...finir('no_go'));
  assert.deepEqual([e.etape, e.essaisQa], ['implementation', 2]);
  e = suite({ ...e, etape: 'qa' }, ...finir('no_go'));
  assert.deepEqual([e.etape, e.statut, e.essaisQa], ['qa', 'bloquee', 3]);
});

test('renvoi avec commentaire : implémentation relancée, essais remis à zéro', () => {
  const v: EtatTache = { ...initial, etape: 'validation', statut: 'attente_humain', essaisQa: 2 };
  assert.deepEqual(suite(v, { type: 'validation', decision: 'renvoi' }), { ...v, etape: 'implementation', statut: 'prete', essaisQa: 0, raison: null });
});

test('pause, reprise humaine, blocage et redémarrage', () => {
  const enCours = suite(initial, { type: 'demarrage' });
  const pause = suite(enCours, { type: 'pause', raison: 'escalade', detail: 'npm install csv-parsr' });
  assert.equal(pause.raison, 'escalade : npm install csv-parsr');
  assert.equal(suite(pause, { type: 'reprise' }).statut, 'prete');
  assert.equal(suite(enCours, { type: 'bloquee', detail: 'étape trop longue' }).statut, 'bloquee');
  assert.deepEqual(suite(enCours, { type: 'redemarrage' }), { ...initial });
});

test('transitions invalides refusées', () => {
  assert.throws(() => transition(initial, { type: 'etape_terminee' }), TransitionInvalide);
  assert.throws(() => transition(initial, { type: 'reprise' }), TransitionInvalide);
  assert.throws(() => suite(initial, { type: 'demarrage' }, { type: 'demarrage' }), TransitionInvalide);
  assert.throws(() => suite({ ...initial, etape: 'patron_plan' }, { type: 'demarrage' }, { type: 'etape_terminee' }), TransitionInvalide);
  const finie: EtatTache = { ...initial, statut: 'terminee' };
  assert.throws(() => transition(finie, { type: 'abandon' }), TransitionInvalide);
});
