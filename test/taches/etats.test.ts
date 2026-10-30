import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition, TransitionInvalide, RAISON_PROPOSITION, RAISON_QUESTIONS, type EtatTache, type Evenement } from '../../src/taches/etats.ts';

const initial: EtatTache = { etape: 'cadrage', statut: 'prete', raison: null, echangesPlan: 0, essaisQa: 0 };
const suite = (e: EtatTache, ...evs: Evenement[]) => evs.reduce(transition, e);
const finir = (verdict?: 'ok' | 'objection' | 'go' | 'no_go'): Evenement[] => [{ type: 'demarrage' }, { type: 'etape_terminee', verdict }];
const cadrageValide: Evenement[] = [{ type: 'demarrage' }, { type: 'etape_terminee', verdict: 'proposition' }, { type: 'validation_cadrage' }];

test('parcours nominal jusqu’à la validation', () => {
  const e = suite(initial, ...cadrageValide, ...finir('ok'), ...finir(), ...finir(), ...finir(), ...finir('go'));
  assert.equal(e.etape, 'validation');
  assert.equal(e.statut, 'attente_humain');
  assert.equal(suite(e, { type: 'validation', decision: 'pr' }).statut, 'terminee');
  assert.equal(suite(e, { type: 'validation', decision: 'abandon' }).statut, 'abandonnee');
});

test('objections du patron : deux échanges puis arbitrage humain', () => {
  let e = suite(initial, ...cadrageValide, ...finir('objection'));
  assert.deepEqual([e.etape, e.statut, e.echangesPlan], ['cadrage', 'prete', 1]);
  e = suite(e, ...cadrageValide, ...finir('objection'));
  assert.deepEqual([e.etape, e.statut, e.echangesPlan], ['patron_plan', 'attente_humain', 2]);
  assert.equal(suite(e, { type: 'arbitrage', choix: 'cadreur' }).etape, 'implementation');
  assert.equal(suite(e, { type: 'arbitrage', choix: 'alternative' }).etape, 'cadrage');
});

test('cadrage : questions, réponse, proposition, validation', () => {
  let e = suite(initial, { type: 'demarrage' }, { type: 'etape_terminee', verdict: 'questions' });
  assert.deepEqual([e.etape, e.statut, e.raison], ['cadrage', 'attente_humain', RAISON_QUESTIONS]);
  assert.throws(() => suite(e, { type: 'validation_cadrage' }), TransitionInvalide);
  e = suite(e, { type: 'reponse_cadrage' });
  assert.deepEqual([e.etape, e.statut], ['cadrage', 'prete']);
  e = suite(e, { type: 'demarrage' }, { type: 'etape_terminee', verdict: 'proposition' });
  assert.deepEqual([e.statut, e.raison], ['attente_humain', RAISON_PROPOSITION]);
  assert.deepEqual([suite(e, { type: 'reponse_cadrage' }).etape, suite(e, { type: 'reponse_cadrage' }).statut], ['cadrage', 'prete']);
  e = suite(e, { type: 'validation_cadrage' });
  assert.deepEqual([e.etape, e.statut, e.raison], ['patron_plan', 'prete', null]);
});

test('cadrage : fin sans questions ni proposition refusée, portes refusées hors cadrage', () => {
  const enCours = suite(initial, { type: 'demarrage' });
  assert.throws(() => suite(enCours, { type: 'etape_terminee' }), TransitionInvalide);
  assert.throws(() => suite(enCours, { type: 'etape_terminee', verdict: 'ok' }), TransitionInvalide);
  const patron: EtatTache = { ...initial, etape: 'patron_plan', statut: 'attente_humain', raison: RAISON_PROPOSITION };
  assert.throws(() => suite(patron, { type: 'validation_cadrage' }), TransitionInvalide);
  assert.throws(() => suite(patron, { type: 'reponse_cadrage' }), TransitionInvalide);
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

test('relance depuis bloquée : implémentation ou cadrage, compteurs remis à zéro', () => {
  const bloquee: EtatTache = { etape: 'qa', statut: 'bloquee', raison: '3 no-go du QA : la tâche me revient', echangesPlan: 1, essaisQa: 3 };
  assert.deepEqual(transition(bloquee, { type: 'relance', vers: 'implementation' }), { ...bloquee, etape: 'implementation', statut: 'prete', raison: null, essaisQa: 0 });
  assert.deepEqual(transition(bloquee, { type: 'relance', vers: 'cadrage' }), { ...bloquee, etape: 'cadrage', statut: 'prete', raison: null, essaisQa: 0, echangesPlan: 0 });
});

test('relance après une alerte d’intégrité : compte un no-go', () => {
  const pause: EtatTache = { etape: 'qa', statut: 'en_pause', raison: 'integrite : la branche a changé', echangesPlan: 0, essaisQa: 1 };
  assert.deepEqual(transition(pause, { type: 'relance', vers: 'implementation' }), { ...pause, etape: 'implementation', statut: 'prete', raison: null, essaisQa: 2 });
  const derniere = { ...pause, essaisQa: 2 };
  assert.deepEqual(transition(derniere, { type: 'relance', vers: 'implementation' }), { ...derniere, statut: 'bloquee', essaisQa: 3, raison: '3 no-go du QA : la tâche me revient' });
  assert.throws(() => transition(pause, { type: 'relance', vers: 'cadrage' }), TransitionInvalide);
});

test('relance refusée hors blocage et hors alerte d’intégrité', () => {
  for (const e of [
    { etape: 'implementation', statut: 'en_cours', raison: null, echangesPlan: 0, essaisQa: 0 },
    { etape: 'implementation', statut: 'en_pause', raison: 'budget : plafond', echangesPlan: 0, essaisQa: 0 },
    { etape: 'validation', statut: 'attente_humain', raison: 'en attente de ma validation', echangesPlan: 0, essaisQa: 0 },
  ] as EtatTache[]) assert.throws(() => transition(e, { type: 'relance', vers: 'implementation' }), TransitionInvalide);
});

test('abandon seulement quand aucun agent ne travaille', () => {
  const base = { etape: 'implementation', raison: null, echangesPlan: 0, essaisQa: 0 } as const;
  for (const statut of ['attente_humain', 'en_pause', 'bloquee'] as const)
    assert.equal(transition({ ...base, statut }, { type: 'abandon' }).statut, 'abandonnee');
  for (const statut of ['prete', 'en_cours'] as const)
    assert.throws(() => transition({ ...base, statut }, { type: 'abandon' }), TransitionInvalide);
});
