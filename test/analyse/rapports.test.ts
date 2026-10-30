import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lireDotnetVulnerables, lireGitleaks, lireNpmAudit, lireSemgrep, lireTrx } from '../../src/analyse/rapports.ts';

test('TRX : total et échecs', () => {
  assert.deepEqual(lireTrx('<TestRun><ResultSummary outcome="Failed"><Counters total="12" executed="12" passed="10" failed="2" /></ResultSummary></TestRun>'), { total: 12, echecs: 2 });
  assert.equal(lireTrx('pas du xml'), null);
});

test('npm audit : sévérités normalisées', () => {
  const json = JSON.stringify({ vulnerabilities: { 'csv-parsr': { name: 'csv-parsr', severity: 'critical', via: [] }, lodash: { name: 'lodash', severity: 'moderate', via: [] } } });
  assert.deepEqual(lireNpmAudit(json)!.map(c => [c.severite, c.message]), [['critique', 'csv-parsr : vulnérabilité critical'], ['moyenne', 'lodash : vulnérabilité moderate']]);
  assert.equal(lireNpmAudit('{}')!.length, 0);
  assert.equal(lireNpmAudit('{'), null);
});

test('dotnet list package --vulnerable : paquets directs et transitifs', () => {
  const json = JSON.stringify({ projects: [{ path: '/workspace/projet/Film.Api/Film.Api.csproj', frameworks: [{ framework: 'net8.0',
    topLevelPackages: [{ id: 'QuestPDF', resolvedVersion: '2022.1.0', vulnerabilities: [{ severity: 'High', advisoryurl: 'https://x' }] }],
    transitivePackages: [{ id: 'System.Text.Json', resolvedVersion: '6.0.0', vulnerabilities: [{ severity: 'Low', advisoryurl: 'https://y' }] }] }] }] });
  assert.deepEqual(lireDotnetVulnerables(json)!.map(c => [c.severite, c.message]), [['haute', 'QuestPDF 2022.1.0 : vulnérabilité High'], ['basse', 'System.Text.Json 6.0.0 : vulnérabilité Low']]);
  assert.deepEqual(lireDotnetVulnerables(JSON.stringify({ projects: [{ path: 'a' }] })), []);
});

test('Semgrep : sévérité et emplacement', () => {
  const json = JSON.stringify({ results: [{ check_id: 'csharp.sqli', path: 'src/Repo.cs', start: { line: 42 }, extra: { severity: 'ERROR', message: 'Injection SQL possible' } }] });
  assert.deepEqual(lireSemgrep(json), [{ outil: 'semgrep', severite: 'haute', message: 'csharp.sqli : Injection SQL possible', fichier: 'src/Repo.cs:42' }]);
});

test('gitleaks : jamais la valeur du secret', () => {
  const json = JSON.stringify([{ RuleID: 'aws-access-token', File: 'src/config.ts', StartLine: 3, Secret: 'AKIAFAUX', Match: 'key=AKIAFAUX' }]);
  const [c] = lireGitleaks(json)!;
  assert.deepEqual(c, { outil: 'gitleaks', severite: 'critique', message: 'secret détecté (aws-access-token)', fichier: 'src/config.ts:3' });
  assert.ok(!JSON.stringify(c).includes('AKIAFAUX'));
  assert.deepEqual(lireGitleaks('[]'), []);
  assert.equal(lireGitleaks('{"pas":"un tableau"}'), null);
});

test('sorties réelles du spike lisibles', () => {
  const cas: [string, (t: string) => unknown][] = [
    ['dotnet.trx', lireTrx], ['npm-audit.json', lireNpmAudit], ['dotnet-vulnerables.json', lireDotnetVulnerables],
    ['semgrep.json', lireSemgrep], ['gitleaks.json', lireGitleaks],
  ];
  for (const [f, lire] of cas) {
    const chemin = `test/fixtures/analyse/${f}`;
    if (fs.existsSync(chemin)) assert.notEqual(lire(fs.readFileSync(chemin, 'utf8')), null, f);
  }
});

const lireFixture = (f: string) => fs.readFileSync(`test/fixtures/analyse/${f}`, 'utf8');

test('TRX réel : BOM et espace de noms, un test en échec sur deux', () => {
  assert.deepEqual(lireTrx(lireFixture('dotnet.trx')), { total: 2, echecs: 1 });
});

test('npm audit en erreur réseau (E6) : jamais lu comme zéro constat', () => {
  const erreur = JSON.stringify({ message: 'request to https://registry.npmjs.org/... failed, reason: getaddrinfo EAI_AGAIN', error: { summary: '', detail: '' } });
  assert.equal(lireNpmAudit(erreur), null);
  assert.equal(lireNpmAudit('{"vulnerabilities":[]}'), null);
  assert.equal(lireNpmAudit('{"vulnerabilities":null}'), null);
  assert.equal(lireNpmAudit('[]'), null);
  assert.deepEqual(lireNpmAudit('{"auditReportVersion":2,"vulnerabilities":{}}'), []);
});

test('npm audit réel : lodash haute, minimist critique', () => {
  assert.deepEqual(lireNpmAudit(lireFixture('npm-audit.json'))!.map(c => [c.severite, c.message]),
    [['haute', 'lodash : vulnérabilité high'], ['critique', 'minimist : vulnérabilité critical']]);
});

test('dotnet vulnérables réel : projet sans frameworks ignoré', () => {
  assert.deepEqual(lireDotnetVulnerables(lireFixture('dotnet-vulnerables.json')),
    [{ outil: 'audit_dotnet', severite: 'haute', message: 'Newtonsoft.Json 12.0.1 : vulnérabilité High', fichier: null }]);
  assert.equal(lireDotnetVulnerables('error: Unable to load the service index for source https://api.nuget.org/v3/index.json'), null);
});

test('Semgrep (E14) : préfixe opt.analyse. retiré, ligne conservée', () => {
  const [c] = lireSemgrep(lireFixture('semgrep.json'))!;
  assert.equal(c.outil, 'semgrep');
  assert.ok(c.message.startsWith('csharp.lang.security.regular-expression-dos'), c.message);
  assert.ok(!c.message.includes('opt.analyse.'));
  assert.equal(c.fichier, 'src/Demo.Lib/Remise.cs:23');
  assert.equal(c.severite, 'moyenne');
});

test('gitleaks réel : règle et emplacement seulement', () => {
  const brut = lireFixture('gitleaks.json');
  const constats = lireGitleaks(brut)!;
  assert.ok(constats.length > 0);
  assert.deepEqual(constats[0], { outil: 'gitleaks', severite: 'critique', message: 'secret détecté (aws-access-token)', fichier: 'config/aws.env:2' });
  assert.ok(Object.keys(constats[0]).every(k => ['outil', 'severite', 'message', 'fichier'].includes(k)));
});
