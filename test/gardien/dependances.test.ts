import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependancesCommande, dependancesFichier, ficheDependance } from '../../src/gardien/dependances.ts';

test('dépendances ajoutées par une commande', () => {
  assert.deepEqual(dependancesCommande('npm install csv-parsr@0.1.2'), [{ ecosysteme: 'npm', nom: 'csv-parsr', version: '0.1.2' }]);
  assert.deepEqual(dependancesCommande('npm i -D @scope/outil@^2 left-pad'), [
    { ecosysteme: 'npm', nom: '@scope/outil', version: '^2' }, { ecosysteme: 'npm', nom: 'left-pad', version: null }]);
  assert.deepEqual(dependancesCommande('dotnet add Film.Api package QuestPDF --version 2024.3.0'), [{ ecosysteme: 'NuGet', nom: 'QuestPDF', version: '2024.3.0' }]);
  assert.deepEqual(dependancesCommande('dotnet add package ClosedXML'), [{ ecosysteme: 'NuGet', nom: 'ClosedXML', version: null }]);
  assert.deepEqual(dependancesCommande('ng add @angular/material'), [{ ecosysteme: 'npm', nom: '@angular/material', version: null }]);
  assert.deepEqual(dependancesCommande('npm ci'), []);
  assert.deepEqual(dependancesCommande('npm install'), []);
});

test('dépendances ajoutées dans un fichier', () => {
  const avant = JSON.stringify({ dependencies: { '@angular/core': '20.0.0' } });
  const apres = JSON.stringify({ dependencies: { '@angular/core': '20.0.0', 'csv-parsr': '0.1.2' }, devDependencies: { karma: '6' } });
  assert.deepEqual(dependancesFichier('/workspace/projet/package.json', avant, apres), [
    { ecosysteme: 'npm', nom: 'csv-parsr', version: '0.1.2' }, { ecosysteme: 'npm', nom: 'karma', version: '6' }]);
  assert.equal(dependancesFichier('/workspace/projet/package.json', avant, '{ illisible'), null);
  const csproj = '<Project><ItemGroup><PackageReference Include="QuestPDF" Version="2024.3.0" /><PackageReference Version="1.0" Include="ClosedXML"/></ItemGroup></Project>';
  assert.deepEqual(dependancesFichier('/workspace/projet/Film.Api/Film.Api.csproj', '<Project><ItemGroup><PackageReference Include="questpdf" Version="2024.3.0" /></ItemGroup></Project>', csproj),
    [{ ecosysteme: 'NuGet', nom: 'ClosedXML', version: '1.0' }]);
  assert.deepEqual(dependancesFichier('/workspace/projet/src/app.ts', null, 'x'), []);
});

type Reponse = { statut: number; corps?: unknown };
const fauxFetch = (routes: Record<string, Reponse>) => (async (url: string | URL | Request) => {
  const cle = Object.keys(routes).find(k => String(url).startsWith(k));
  if (!cle) throw new Error(`réseau coupé : ${url}`);
  const r = routes[cle];
  return new Response(JSON.stringify(r.corps ?? {}), { status: r.statut });
}) as typeof fetch;

test('fiche npm : paquet récent et peu téléchargé', async () => {
  const f = await ficheDependance({ ecosysteme: 'npm', nom: 'csv-parsr', version: '0.1.2' }, fauxFetch({
    'https://registry.npmjs.org/csv-parsr': { statut: 200, corps: { 'dist-tags': { latest: '0.1.2' }, time: { created: '2026-10-25T00:00:00Z', '0.1.2': '2026-10-25T00:00:00Z' }, versions: { '0.1.2': { license: 'MIT' } } } },
    'https://api.npmjs.org/downloads/point/last-week/csv-parsr': { statut: 200, corps: { downloads: 31 } },
    'https://api.osv.dev/v1/query': { statut: 200, corps: {} },
  }));
  assert.deepEqual(f, { ecosysteme: 'npm', nom: 'csv-parsr', version: '0.1.2', existe: true, telechargements: 31, periode: 'semaine', publieLe: '2026-10-25T00:00:00Z', licence: 'MIT', vulnerabilites: 0, erreur: null });
});

test('fiche npm : paquet introuvable', async () => {
  const f = await ficheDependance({ ecosysteme: 'npm', nom: 'n-existe-pas', version: null }, fauxFetch({ 'https://registry.npmjs.org/': { statut: 404 } }));
  assert.equal(f.existe, false);
});

test('fiche : réseau en panne = fiche incomplète, pas d’exception', async () => {
  const f = await ficheDependance({ ecosysteme: 'npm', nom: 'x', version: null }, fauxFetch({}));
  assert.equal(f.existe, null);
  assert.match(f.erreur ?? '', /réseau coupé/);
});

test('fiche NuGet avec vulnérabilité', async () => {
  const f = await ficheDependance({ ecosysteme: 'NuGet', nom: 'QuestPDF', version: null }, fauxFetch({
    'https://azuresearch-usnc.nuget.org/query': { statut: 200, corps: { data: [{ id: 'QuestPDF', version: '2024.3.0', totalDownloads: 7_200_000, licenseUrl: 'https://www.nuget.org/packages/QuestPDF/license' }] } },
    'https://api.osv.dev/v1/query': { statut: 200, corps: { vulns: [{ id: 'GHSA-x' }] } },
  }));
  assert.deepEqual([f.existe, f.version, f.telechargements, f.periode, f.vulnerabilites], [true, '2024.3.0', 7_200_000, 'total', 1]);
});

const fetchCompte = () => {
  const appels: string[] = [];
  const f = (async (url: string | URL | Request) => { appels.push(String(url)); return new Response('{}', { status: 404 }); }) as typeof fetch;
  return { f, appels };
};

test('spécification hors registre : refus sans aucun appel réseau', async () => {
  const [d] = dependancesCommande('npm i left-pad@npm:evil');
  assert.deepEqual(d, { ecosysteme: 'npm', nom: 'left-pad', version: 'npm:evil' });
  const { f, appels } = fetchCompte();
  const fiche = await ficheDependance(d, f);
  assert.equal(fiche.existe, false);
  assert.equal(fiche.erreur, 'source hors registre');
  assert.deepEqual(appels, []);
});

test('nom ressemblant à une source hors registre : refus sans appel réseau', async () => {
  const { f, appels } = fetchCompte();
  const fiche = await ficheDependance({ ecosysteme: 'npm', nom: 'evil/pkg', version: null }, f);
  assert.equal(fiche.erreur, 'source hors registre');
  assert.deepEqual(appels, []);
});

test('plage de versions NuGet : OSV interrogé sans version', async () => {
  const corps: unknown[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://api.osv.dev')) { corps.push(JSON.parse(String(init?.body))); return new Response('{}'); }
    return new Response(JSON.stringify({ data: [{ id: 'QuestPDF', version: '2024.3.0', totalDownloads: 1 }] }));
  }) as typeof fetch;
  const fiche = await ficheDependance({ ecosysteme: 'NuGet', nom: 'QuestPDF', version: '[2024,)' }, f);
  assert.equal(fiche.version, null);
  assert.deepEqual(corps, [{ package: { name: 'QuestPDF', ecosystem: 'NuGet' } }]);
});

test('changement de spécification détecté à nom identique', () => {
  assert.deepEqual(dependancesFichier('/workspace/projet/package.json', JSON.stringify({ dependencies: { 'left-pad': '1.0.0' } }),
    JSON.stringify({ dependencies: { 'left-pad': 'npm:evil@1' } })), [{ ecosysteme: 'npm', nom: 'left-pad', version: 'npm:evil@1' }]);
});

test('overrides et resolutions scannés, objets imbriqués comparés en JSON', () => {
  assert.deepEqual(dependancesFichier('/workspace/projet/package.json', JSON.stringify({ overrides: { foo: { bar: '1' } } }),
    JSON.stringify({ overrides: { foo: { bar: '2' } }, resolutions: { baz: '3' } })), [
    { ecosysteme: 'npm', nom: 'foo', version: '{"bar":"2"}' }, { ecosysteme: 'npm', nom: 'baz', version: '3' }]);
});

test('NuGet : attributs entre guillemets simples', () => {
  assert.deepEqual(dependancesFichier('/workspace/projet/P.csproj', '<Project/>', "<Project><PackageReference Include='Evil' Version='1' /></Project>"),
    [{ ecosysteme: 'NuGet', nom: 'Evil', version: '1' }]);
});

test('commandes enveloppées ou alternatives détectées', () => {
  assert.deepEqual(dependancesCommande('bash -c "npm i evil-pkg"'), [{ ecosysteme: 'npm', nom: 'evil-pkg', version: null }]);
  assert.deepEqual(dependancesCommande('sudo npm install x'), [{ ecosysteme: 'npm', nom: 'x', version: null }]);
  assert.deepEqual(dependancesCommande('env A=1 npm i x'), [{ ecosysteme: 'npm', nom: 'x', version: null }]);
  assert.deepEqual(dependancesCommande('npx cowsay'), [{ ecosysteme: 'npm', nom: 'cowsay', version: null }]);
  assert.deepEqual(dependancesCommande('yarn add x'), [{ ecosysteme: 'npm', nom: 'x', version: null }]);
  assert.deepEqual(dependancesCommande('npm i --prefix dir pkg'), [{ ecosysteme: 'npm', nom: 'pkg', version: null }]);
  assert.deepEqual(dependancesCommande('dotnet add package X -v 1.0'), [{ ecosysteme: 'NuGet', nom: 'X', version: '1.0' }]);
  assert.deepEqual(dependancesCommande('dotnet tool install -g dotnet-evil'), [{ ecosysteme: 'NuGet', nom: 'dotnet-evil', version: null }]);
});
