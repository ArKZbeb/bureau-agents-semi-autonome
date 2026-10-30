import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ouvrirBase } from '../../src/db.ts';
import { detecterProjet, listerProjets, lireProjet, relierProjet } from '../../src/taches/projets.ts';

function dossier(fichiers: string[], git = true): string {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-'));
  if (git) fs.mkdirSync(path.join(racine, '.git'));
  for (const f of fichiers) {
    fs.mkdirSync(path.dirname(path.join(racine, f)), { recursive: true });
    fs.writeFileSync(path.join(racine, f), '');
  }
  return racine;
}
const base = () => ouvrirBase(':memory:');

test('détecte une solution .NET, ses projets et ses projets de tests', () => {
  const d = detecterProjet(dossier(['Planning.sln', 'src/Planning.Api/Planning.Api.csproj', 'src/Planning.Domaine/Planning.Domaine.csproj', 'tests/Planning.Tests/Planning.Tests.csproj']));
  assert.deepEqual(d.dotnet, { solution: 'Planning.sln', projets: 3, projetsTests: 1 });
  assert.equal(d.angular, null);
  assert.equal(d.git, true);
});

test('détecte un espace Angular par son angular.json', () => {
  const d = detecterProjet(dossier(['planning-web/angular.json', 'planning-web/src/main.ts']));
  assert.deepEqual(d.angular, { fichier: 'planning-web/angular.json' });
  assert.equal(d.dotnet, null);
});

test('nom proposé = nom du dossier', () => {
  const racine = dossier([]);
  assert.equal(detecterProjet(racine).nomPropose, path.basename(racine));
});

test('ignore node_modules, bin, obj, dist, .angular et .git', () => {
  const d = detecterProjet(dossier(['node_modules/x/angular.json', 'bin/A.csproj', 'obj/B.csproj', 'dist/angular.json', '.angular/angular.json', 'App.csproj']));
  assert.deepEqual(d.dotnet, { solution: null, projets: 1, projetsTests: 0 });
  assert.equal(d.angular, null);
});

test('ne suit pas les liens symboliques', () => {
  const ailleurs = dossier(['Cache.csproj'], false);
  const racine = dossier([]);
  fs.symlinkSync(ailleurs, path.join(racine, 'lien'));
  assert.equal(detecterProjet(racine).dotnet, null);
});

test('s’arrête à 4 niveaux de profondeur', () => {
  assert.equal(detecterProjet(dossier(['a/b/c/d/e/Profond.csproj'])).dotnet, null);
  assert.notEqual(detecterProjet(dossier(['a/b/c/Visible.csproj'])).dotnet, null);
});

test('chemin relatif ou introuvable refusé', () => {
  assert.throws(() => detecterProjet('relatif/projet'), /chemin absolu attendu/);
  assert.throws(() => detecterProjet('/n/existe/pas'), /dossier introuvable/);
});

test('relier enregistre le projet et son seuil', () => {
  const db = base();
  const chemin = dossier(['App.sln', 'App/App.csproj']);
  const p = relierProjet(db, { nom: 'Planning', chemin, budgetUsd: 6, couvertureLignes: 85 });
  assert.equal(p.couvertureLignes, 85);
  assert.deepEqual(lireProjet(db, 'Planning', 80), p);
  assert.deepEqual(listerProjets(db, 80).map(x => x.nom), ['Planning']);
});

test('relier refuse un dossier sans dépôt Git ou sans stack', () => {
  const db = base();
  assert.throws(() => relierProjet(db, { nom: 'A', chemin: dossier(['App.csproj'], false), budgetUsd: 6, couvertureLignes: 80 }), /pas un dépôt Git/);
  assert.throws(() => relierProjet(db, { nom: 'B', chemin: dossier(['README.md']), budgetUsd: 6, couvertureLignes: 80 }), /aucune stack \.NET ou Angular/);
});

test('relier refuse nom invalide, budget invalide, seuil invalide, doublon', () => {
  const db = base();
  const chemin = dossier(['App.csproj']);
  assert.throws(() => relierProjet(db, { nom: '../x', chemin, budgetUsd: 6, couvertureLignes: 80 }), /nom de projet invalide/);
  assert.throws(() => relierProjet(db, { nom: 'A', chemin, budgetUsd: 0, couvertureLignes: 80 }), /budget/);
  assert.throws(() => relierProjet(db, { nom: 'A', chemin, budgetUsd: 6, couvertureLignes: 101 }), /seuil de couverture/);
  relierProjet(db, { nom: 'A', chemin, budgetUsd: 6, couvertureLignes: 80 });
  assert.throws(() => relierProjet(db, { nom: 'A', chemin: dossier(['B.csproj']), budgetUsd: 6, couvertureLignes: 80 }), /déjà relié/);
  assert.throws(() => relierProjet(db, { nom: 'C', chemin, budgetUsd: 6, couvertureLignes: 80 }), /déjà relié/);
  assert.deepEqual(listerProjets(db, 80).map(x => x.nom), ['A']);
});

test('un seuil invalide ne laisse aucun projet enregistré', () => {
  const db = base();
  assert.throws(() => relierProjet(db, { nom: 'A', chemin: dossier(['App.csproj']), budgetUsd: 6, couvertureLignes: 12.5 }));
  assert.equal(lireProjet(db, 'A', 80), null);
});
