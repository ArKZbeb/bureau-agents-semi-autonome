import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblerAnalyse, FICHIERS_ANALYSE, FICHIERS_MESURES, FICHIERS_TESTS } from '../../src/analyse/analyse.ts';

const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const DIFF = 'diff --git a/src/Film.cs b/src/Film.cs\n--- a/src/Film.cs\n+++ b/src/Film.cs\n@@ -1 +1,2 @@\n+a\n+b\n';
const COB = '<coverage><class filename="src/Film.cs"><line number="1" hits="1"/><line number="2" hits="0"/></class></coverage>';

const dotnetSeul = (): Record<string, string | null> => ({
  sha: `${SHA}\n`, 'diff.patch': DIFF,
  'tests_dotnet.code': '1\n', 'dotnet.trx': '<Counters total="5" failed="1" />', 'dotnet.cobertura.xml': COB,
  'audit_dotnet.code': '0', 'dotnet-vulnerables.json': JSON.stringify({ projects: [] }),
  'tests_angular.na': '', 'stack_angular.na': '', 'audit_npm.na': '',
  'semgrep.code': '0', 'semgrep.json': '{"results":[]}',
  'gitleaks.code': '0', 'gitleaks.json': '[]',
});

test('projet .NET : tests en échec, couverture calculée, Angular non applicable', () => {
  const a = assemblerAnalyse(BASE, dotnetSeul());
  assert.equal(a.sha, SHA);
  assert.deepEqual(a.outils, { tests_dotnet: 'echec', audit_dotnet: 'ok', tests_angular: 'non_applicable', audit_npm: 'non_applicable', semgrep: 'ok', gitleaks: 'ok', couverture: 'ok' });
  assert.deepEqual(a.tests, { total: 5, echecs: 1 });
  assert.deepEqual(a.couverture, { couvertes: 1, total: 2, pourcentage: 50, sourcesHorsCouverture: [] });
});

test('outil sans résultat : absent ; rapport illisible : absent', () => {
  const f = dotnetSeul();
  delete f['semgrep.code'];
  f['gitleaks.json'] = '{pas du json';
  f['dotnet.cobertura.xml'] = null;
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.outils.semgrep, 'absent');
  assert.equal(a.outils.gitleaks, 'absent');
  assert.equal(a.outils.couverture, 'absent');
});

test('aucune stack de tests : couverture non applicable', () => {
  const a = assemblerAnalyse(BASE, { sha: SHA, 'diff.patch': '', 'stack_dotnet.na': '', 'stack_angular.na': '', 'tests_dotnet.na': '', 'audit_dotnet.na': '', 'tests_angular.na': '', 'audit_npm.na': '', 'semgrep.code': '0', 'semgrep.json': '{"results":[]}', 'gitleaks.code': '0', 'gitleaks.json': '[]' });
  assert.equal(a.outils.couverture, 'non_applicable');
  assert.equal(a.couverture, null);
});

test('signalements et constats remontés', () => {
  const f = dotnetSeul();
  f['gitleaks.json'] = JSON.stringify([{ RuleID: 'generic-api-key', File: 'src/a.cs', StartLine: 1, Secret: 'x' }]);
  f['diff.patch'] = `${DIFF}diff --git a/karma.conf.js b/karma.conf.js\n--- a/karma.conf.js\n+++ b/karma.conf.js\n@@ -1 +1 @@\n+x\n`;
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.constats[0].message, 'secret détecté (generic-api-key)');
  assert.deepEqual(a.signalements, ['configuration de test ou de couverture modifiée : karma.conf.js']);
});

test('liste des fichiers à relire', () => {
  for (const f of ['sha', 'diff.patch', 'tests_dotnet.code', 'tests_dotnet.na', 'dotnet.trx', 'gitleaks.json']) assert.ok(FICHIERS_ANALYSE.includes(f), f);
});

test('listes de fichiers : mesures et tests séparés, concaténés dans FICHIERS_ANALYSE', () => {
  for (const f of ['sha', 'diff.patch', 'semgrep.code', 'semgrep.json', 'gitleaks.code', 'gitleaks.json', 'audit_npm.code', 'audit_npm.na', 'npm-audit.json']) assert.ok(FICHIERS_MESURES.includes(f), f);
  for (const f of ['tests_dotnet.code', 'tests_dotnet.na', 'audit_dotnet.code', 'tests_angular.code', 'dotnet.trx', 'dotnet.cobertura.xml', 'dotnet-vulnerables.json', 'angular.cobertura.xml']) assert.ok(FICHIERS_TESTS.includes(f), f);
  assert.ok(!FICHIERS_MESURES.some(f => FICHIERS_TESTS.includes(f)));
  assert.deepEqual(FICHIERS_ANALYSE, [...FICHIERS_MESURES, ...FICHIERS_TESTS]);
});

test('code 3 (mesure impossible) : absent, jamais échec', () => {
  const f = dotnetSeul();
  f['tests_dotnet.code'] = '3\n';
  f['audit_dotnet.code'] = '3\n';
  delete f['tests_angular.na'];
  f['tests_angular.code'] = '3\n';
  f['audit_npm.code'] = '3\n';
  delete f['audit_npm.na'];
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.outils.tests_dotnet, 'absent');
  assert.equal(a.outils.audit_dotnet, 'absent');
  assert.equal(a.outils.tests_angular, 'absent');
  assert.equal(a.outils.audit_npm, 'absent');
  assert.equal(a.outils.couverture, 'absent');
});

test('Semgrep, gitleaks et audits en erreur (code non nul) : absent même avec un rapport lisible', () => {
  const f = dotnetSeul();
  f['semgrep.code'] = '2';
  f['gitleaks.code'] = '1';
  f['audit_dotnet.code'] = '1';
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.outils.semgrep, 'absent');
  assert.equal(a.outils.gitleaks, 'absent');
  assert.equal(a.outils.audit_dotnet, 'absent');
});

test('Angular seul : tests ok et couverture lue dans angular.cobertura.xml', () => {
  const f: Record<string, string | null> = { sha: SHA, 'diff.patch': DIFF, 'stack_dotnet.na': '', 'tests_dotnet.na': '', 'audit_dotnet.na': '', 'tests_angular.code': '0', 'angular.cobertura.xml': COB, 'audit_npm.code': '0', 'npm-audit.json': '{"vulnerabilities":{}}', 'semgrep.code': '0', 'semgrep.json': '{"results":[]}', 'gitleaks.code': '0', 'gitleaks.json': '[]' };
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.outils.tests_angular, 'ok');
  assert.equal(a.outils.audit_npm, 'ok');
  assert.equal(a.outils.couverture, 'ok');
  assert.equal(a.tests, null);
});

test('deux stacks testées dont une sans Cobertura lisible : couverture absente', () => {
  const f = dotnetSeul();
  delete f['tests_angular.na'];
  f['tests_angular.code'] = '0';
  f['angular.cobertura.xml'] = null;
  f['dotnet.trx'] = '<Counters total="5" failed="0" />';
  f['tests_dotnet.code'] = '0';
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.outils.tests_angular, 'ok');
  assert.equal(a.outils.couverture, 'absent');
  assert.equal(a.couverture, null);
});

test('diff.patch absent : couverture absente', () => {
  const f = dotnetSeul();
  delete f['diff.patch'];
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.outils.couverture, 'absent');
  assert.equal(a.couverture, null);
});

test('sha invalide ou absent : mesures statiques et couverture forcées à absent, sans constats', () => {
  for (const sha of [null, 'abc', `${SHA}\nautre`, 'g'.repeat(40)]) {
    const f = dotnetSeul();
    f.sha = sha;
    f['gitleaks.json'] = JSON.stringify([{ RuleID: 'generic-api-key', File: 'src/a.cs', StartLine: 1, Secret: 'x' }]);
    const a = assemblerAnalyse(BASE, f);
    for (const o of ['semgrep', 'gitleaks', 'audit_npm', 'couverture'] as const) {
      assert.equal(a.outils[o], 'absent', `${String(sha)} ${o}`);
    }
    assert.deepEqual(a.constats, []);
    assert.equal(a.outils.tests_dotnet, 'echec');
  }
});

const ajout = (fichier: string, lignes = 1) =>
  `diff --git a/${fichier} b/${fichier}\n--- a/${fichier}\n+++ b/${fichier}\n@@ -0,0 +1,${lignes} @@\n${'+x\n'.repeat(lignes)}`;

test('fichiers source modifiés absents de toute Cobertura : signalés (tests, autres extensions et fichiers couverts exclus)', () => {
  const f = dotnetSeul();
  f['diff.patch'] = DIFF + ajout('src/Autre.cs') + ajout('web/src/app/carte.ts') + ajout('tests/FilmTests.cs') + ajout('README.md');
  const a = assemblerAnalyse(BASE, f);
  assert.deepEqual(a.couverture, { couvertes: 1, total: 2, pourcentage: 50, sourcesHorsCouverture: ['src/Autre.cs', 'web/src/app/carte.ts'] },
    'choix 3 : lignes non instrumentées ignorées du pourcentage, sources absentes listées (no-go par reglesQa)');
  assert.deepEqual(a.signalements, ['2 fichier(s) source modifié(s) absent(s) de la couverture']);
});

test('aucune ligne modifiée instrumentée alors que des sources sont modifiées : couverture non mesurable signalée', () => {
  const absent = dotnetSeul();
  absent['diff.patch'] = ajout('src/Autre.cs', 3);
  assert.deepEqual(assemblerAnalyse(BASE, absent).signalements, [
    '1 fichier(s) source modifié(s) absent(s) de la couverture', 'couverture non mesurable sur les lignes modifiées',
  ]);
  assert.deepEqual(assemblerAnalyse(BASE, absent).couverture, { couvertes: 0, total: 0, pourcentage: null, sourcesHorsCouverture: ['src/Autre.cs'] });
  // Fichier présent dans la Cobertura, mais ses lignes modifiées ne sont pas instrumentées (commentaires...).
  const commentaires = dotnetSeul();
  commentaires['diff.patch'] = 'diff --git a/src/Film.cs b/src/Film.cs\n--- a/src/Film.cs\n+++ b/src/Film.cs\n@@ -8 +8,2 @@\n+// a\n+// b\n';
  const a = assemblerAnalyse(BASE, commentaires);
  assert.deepEqual(a.couverture, { couvertes: 0, total: 0, pourcentage: null, sourcesHorsCouverture: [] });
  assert.deepEqual(a.signalements, ['couverture non mesurable sur les lignes modifiées']);
});

test('sans source modifiée ou sans stack testée : aucun signalement de couverture', () => {
  const doc = dotnetSeul();
  doc['diff.patch'] = ajout('README.md') + ajout('tests/FilmTests.cs');
  assert.deepEqual(assemblerAnalyse(BASE, doc).signalements, []);
  assert.deepEqual(assemblerAnalyse(BASE, doc).couverture?.sourcesHorsCouverture, []);
  const rien: Record<string, string | null> = {
    sha: SHA, 'diff.patch': ajout('src/Autre.cs'), 'stack_dotnet.na': '', 'stack_angular.na': '', 'tests_dotnet.na': '', 'audit_dotnet.na': '', 'tests_angular.na': '', 'audit_npm.na': '',
    'semgrep.code': '0', 'semgrep.json': '{"results":[]}', 'gitleaks.code': '0', 'gitleaks.json': '[]',
  };
  assert.deepEqual(assemblerAnalyse(BASE, rien).signalements, []);
  assert.equal(assemblerAnalyse(BASE, rien).couverture, null, 'aucune stack testée : pas de liste hors couverture');
});

test('non-applicabilité des tests décidée par mesurer.sh : un .na de tester.sh qui la contredit = absent', () => {
  // tester.sh exécute le code du dépôt, qui peut écrire tests_angular.na pour échapper à ng test.
  const f = dotnetSeul();
  delete f['stack_angular.na'];
  const a = assemblerAnalyse(BASE, f);
  assert.equal(a.outils.tests_angular, 'absent');
  assert.equal(a.outils.couverture, 'ok', 'la couverture suit les stacks testées');

  const g: Record<string, string | null> = { ...dotnetSeul(), 'tests_dotnet.na': '', 'audit_dotnet.na': '' };
  for (const k of ['tests_dotnet.code', 'audit_dotnet.code']) delete g[k];
  const b = assemblerAnalyse(BASE, g);
  assert.equal(b.outils.tests_dotnet, 'absent');
  assert.equal(b.outils.audit_dotnet, 'absent');
  assert.equal(b.outils.couverture, 'absent');
  assert.equal(assemblerAnalyse(BASE, { ...g, 'stack_dotnet.na': '' }).outils.tests_dotnet, 'non_applicable');
});

test('fichiers d’applicabilité des stacks relus dans les mesures', () => {
  for (const f of ['stack_dotnet.na', 'stack_angular.na']) assert.ok(FICHIERS_MESURES.includes(f), f);
});
