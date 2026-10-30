import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Analyse } from '../../src/analyse/analyse.ts';
import { reglesQa } from '../../src/analyse/regles.ts';

const analyse = (o: Partial<Analyse> = {}): Analyse => ({
  sha: 'a'.repeat(40), base: 'b'.repeat(40),
  outils: { tests_dotnet: 'ok', audit_dotnet: 'ok', tests_angular: 'non_applicable', audit_npm: 'non_applicable', semgrep: 'ok', gitleaks: 'ok', couverture: 'ok' },
  tests: { total: 12, echecs: 0 }, couverture: { couvertes: 9, total: 10, pourcentage: 90, sourcesHorsCouverture: [] }, constats: [], signalements: [], ...o,
});
const qaGo = { verdict: 'go' as const, criteres: [{ numero: 1, rempli: true, preuve: 'test vert' }] };
const seuils = { couvertureLignes: 80 };

test('tout est vert : go', () => {
  assert.deepEqual(reglesQa(analyse(), seuils, qaGo, ['Le PDF contient le synopsis']), { verdict: 'go', declenchees: [] });
});

test('couverture sous le seuil : message de la maquette', () => {
  const r = reglesQa(analyse({ couverture: { couvertes: 18, total: 25, pourcentage: 72, sourcesHorsCouverture: [] } }), seuils, qaGo, ['c']);
  assert.deepEqual(r, { verdict: 'no_go', declenchees: ['couverture des lignes modifiées 72 % < 80 %'] });
});

test('mesure manquante, tests en échec, faille haute : no-go détaillé', () => {
  const a = analyse({
    outils: { tests_dotnet: 'echec', audit_dotnet: 'ok', tests_angular: 'non_applicable', audit_npm: 'non_applicable', semgrep: 'absent', gitleaks: 'ok', couverture: 'ok' },
    tests: { total: 12, echecs: 2 },
    constats: [{ outil: 'audit_dotnet', severite: 'haute', message: 'QuestPDF 2022.1.0 : vulnérabilité High', fichier: null },
      { outil: 'semgrep', severite: 'moyenne', message: 'avertissement', fichier: 'a.cs:1' }],
  });
  assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']).declenchees, [
    'outil non exécuté : Semgrep', 'tests en échec (2 sur 12)', 'faille haute : QuestPDF 2022.1.0 : vulnérabilité High',
  ]);
});

test('analyse absente : no-go', () => {
  assert.deepEqual(reglesQa(null, seuils, qaGo, ['c']).declenchees, ['analyse absente : aucune mesure']);
});

test('critères et verdict du QA', () => {
  const r = reglesQa(analyse(), seuils, { verdict: 'no_go', criteres: [{ numero: 1, rempli: true, preuve: '' }] }, ['a', 'b']);
  assert.deepEqual(r.declenchees, ['verdict du QA : no-go', 'critère 2 non rempli']);
  assert.deepEqual(reglesQa(analyse(), seuils, qaGo, []).declenchees, ['aucun critère d’acceptation validé']);
});

test('couverture non mesurable ou non applicable : pas de règle de seuil', () => {
  assert.equal(reglesQa(analyse({ couverture: { couvertes: 0, total: 0, pourcentage: null, sourcesHorsCouverture: [] } }), seuils, qaGo, ['c']).verdict, 'go');
});

test('faille critique : message et fichier', () => {
  const a = analyse({ constats: [{ outil: 'gitleaks', severite: 'critique', message: 'secret détecté (generic-api-key)', fichier: 'src/a.cs:3' }] });
  assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']), { verdict: 'no_go', declenchees: ['faille critique : secret détecté (generic-api-key) (src/a.cs:3)'] });
});

test('ng test en échec : no-go', () => {
  const a = analyse({ outils: { ...analyse().outils, tests_angular: 'echec' } });
  assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']), { verdict: 'no_go', declenchees: ['tests en échec (ng test)'] });
});

test('dotnet test en échec sans TRX lisible (tests null) : no-go sans compte', () => {
  const a = analyse({ outils: { ...analyse().outils, tests_dotnet: 'echec' }, tests: null });
  assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']), { verdict: 'no_go', declenchees: ['tests en échec'] });
});

test('couverture absente : outil non exécuté', () => {
  const a = analyse({ outils: { ...analyse().outils, couverture: 'absent' }, couverture: null });
  assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']), { verdict: 'no_go', declenchees: ['outil non exécuté : couverture des lignes modifiées'] });
});

test('0 % mesuré : no-go (zéro reste une mesure)', () => {
  const a = analyse({ couverture: { couvertes: 0, total: 10, pourcentage: 0, sourcesHorsCouverture: [] } });
  assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']), { verdict: 'no_go', declenchees: ['couverture des lignes modifiées 0 % < 80 %'] });
});

test('pourcentage égal au seuil : go', () => {
  const a = analyse({ couverture: { couvertes: 8, total: 10, pourcentage: 80, sourcesHorsCouverture: [] } });
  assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']), { verdict: 'go', declenchees: [] });
});

test('statut d’outil inconnu ou manquant : compté comme absent', () => {
  const outils = { ...analyse().outils, semgrep: 'inconnu', gitleaks: undefined } as unknown as Analyse['outils'];
  assert.deepEqual(reglesQa(analyse({ outils }), seuils, qaGo, ['c']), {
    verdict: 'no_go', declenchees: ['outil non exécuté : Semgrep', 'outil non exécuté : gitleaks'],
  });
});

const hors = (sources: string[], o: Partial<NonNullable<Analyse['couverture']>> = {}) =>
  analyse({ couverture: { couvertes: 9, total: 10, pourcentage: 90, sourcesHorsCouverture: sources, ...o } });

test('fichier source modifié hors couverture : no-go, liste tronquée à 5', () => {
  assert.deepEqual(reglesQa(hors(['src/Autre.cs']), seuils, qaGo, ['c']), {
    verdict: 'no_go', declenchees: ['couverture : 1 fichier(s) source modifié(s) hors couverture (src/Autre.cs)'],
  });
  const sept = ['a.cs', 'b.cs', 'c.cs', 'd.cs', 'e.cs', 'f.cs', 'g.cs'];
  assert.deepEqual(reglesQa(hors(sept), seuils, qaGo, ['c']).declenchees, ['couverture : 7 fichier(s) source modifié(s) hors couverture (a.cs, b.cs, c.cs, d.cs, e.cs, …)']);
});

test('couverture non mesurable avec des sources hors couverture : no-go par la même règle', () => {
  const r = reglesQa(hors(['src/Autre.cs'], { couvertes: 0, total: 0, pourcentage: null }), seuils, qaGo, ['c']);
  assert.deepEqual(r, { verdict: 'no_go', declenchees: ['couverture : 1 fichier(s) source modifié(s) hors couverture (src/Autre.cs)'] });
});

test('liste des sources hors couverture manquante ou illisible : no-go (fail-closed)', () => {
  for (const v of [undefined, null, 'src/a.cs']) {
    const a = hors([], { sourcesHorsCouverture: v as unknown as string[] });
    assert.deepEqual(reglesQa(a, seuils, qaGo, ['c']).declenchees, ['couverture : fichiers source hors couverture inconnus'], String(v));
  }
});
