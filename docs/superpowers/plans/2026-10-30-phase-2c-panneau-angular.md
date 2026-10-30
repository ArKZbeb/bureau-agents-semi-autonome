# Phase 2c — Panneau web Angular minimal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Piloter le bureau depuis le navigateur : relier un projet (avec ses seuils), créer une user story, suivre le kanban, répondre au cadreur, valider spec et plan, arbitrer, reprendre, lire le rapport en construction et le verdict, trancher les escalades, lire le journal et déclencher l'arrêt global.

**Architecture:** Le front Angular vit dans `web/` (paquet npm séparé : Angular 21 exige TypeScript < 6, la racine est en 6.0.3). Il est construit en fichiers statiques que le serveur UI existant (127.0.0.1:4310) sert lui-même, sous une CSP stricte ; le jeton de session passe par le fragment de l'URL affichée au démarrage (`#jeton=…`, jamais envoyé au serveur), puis par l'en-tête `Authorization` de chaque appel `/api`. Côté orchestrateur, une table `projets` et quatre routes s'ajoutent ; la création d'une tâche ne reçoit plus de chemin du navigateur : chemin et budget viennent du projet relié. Le front rafraîchit son état par interrogation toutes les 3 s.

**Tech Stack:** Orchestrateur inchangé (Node 24, TypeScript 6.0.3 par type stripping, `node:test`, `node:sqlite`). Front : Angular 21.2 (LTS), composants autonomes, signaux, sans zone.js, `HttpClient`, tests Vitest 4 + jsdom via `ng test`.

**Spec:** `docs/superpowers/specs/2026-10-28-bureau-agents-design.md` (sections « Le bureau », « Guardrails IA » ligne « Perte de contrôle », « Contrôle d'intégrité » ligne « Pilotage de l'app par un autre programme ou un site web »). Maquette : `maquette/bureau-des-agents.html` (bundle ; textes extraits dans l'annexe A de ce plan).

## Global Constraints

- Textes de l'interface en français, tels que dans la maquette (annexe A). Pas de carte Phaser, pas de mini-carte, pas d'avatar (phase 4).
- YAGNI : seuls les écrans listés ici. Hors 2c : boîte de validation et ses actions (branche, PR, renvoi, abandon), alerte d'intégrité avec diff et restauration (phase 3) ; écrans Réglages, Conteneurs, Notifications, Docker non démarré, Index des écrans, joindre une maquette Claude Design.
- Serveur UI lié à 127.0.0.1 uniquement ; contrôle `Host` sur toute requête (fichiers statiques compris) ; contrôle `Origin` et jeton `Bearer` sur toute route `/api`. Les fichiers statiques ne demandent pas de jeton (aucun secret dedans).
- Le jeton de session n'apparaît jamais dans une requête HTTP autrement que dans l'en-tête `Authorization` : il est lu dans le fragment, rangé en `sessionStorage`, puis le fragment est effacé de l'URL.
- CSP des pages servies : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Aucune ressource externe (pas de Google Fonts, pas de CDN) : polices système.
- Le navigateur ne fournit jamais un chemin de projet à la création d'une tâche : seul `POST /api/projets` reçoit un chemin, que l'orchestrateur contrôle (absolu, dossier existant, dépôt Git, stack .NET ou Angular détectée).
- La détection d'un projet lit seulement des noms de fichiers (jamais leur contenu), ne suit aucun lien symbolique, s'arrête à 4 niveaux et 10 000 entrées, ignore `.git`, `node_modules`, `bin`, `obj`, `dist`, `.angular`.
- Versions exactes (pas de `^` ni `~`) dans `web/package.json` : `@angular/*` 21.2.25 (framework), `@angular/cli` et `@angular/build` 21.2.29, `typescript` 5.9.x (dernière 5.9 publiée, exacte), `vitest` 4.x et `jsdom` (dernières publiées, exactes), `rxjs` 7.8.x, `tslib` 2.x. `package-lock.json` de `web/` versionné. Aucune nouvelle dépendance à la racine.
- Sous Linux : `export npm_config_script_shell=/bin/bash` avant toute commande npm (le `.npmrc` racine vise Git Bash Windows ; ne pas le modifier).
- Tests racine : `npm test` (aucun appel API réel), `npm run typecheck`. Tests du front : `npm run test:web`. Ne jamais affaiblir un test existant ; un changement de contrat de route met à jour les tests concernés et le signale dans le rapport.

## Choix soumis à validation

1. **Jeton par le fragment de l'URL.** Le démarrage affiche `http://127.0.0.1:4310/#jeton=<jeton>`. Un fragment n'est jamais envoyé au serveur ni journalisé ; le front le range en `sessionStorage` (onglet seulement) et l'efface de la barre d'adresse. Alternative écartée : cookie de session (exposé au CSRF, demanderait un jeton anti-CSRF en plus).
2. **Front servi par l'orchestrateur**, construit avec `npm run web:build` dans `web/dist/web/browser`. Pas de serveur de développement Angular dans la chaîne (il contournerait les contrôles `Host`/`Origin`). Si le panneau n'est pas construit, la page dit comment le construire.
3. **Interrogation toutes les 3 s** (tâches, escalades, état global) plutôt qu'un flux SSE : suffisant en solo, rien de nouveau côté serveur.
4. **Projets reliés en base** (`projets` : nom, chemin, budget par tâche) + seuil de couverture dans `seuils_projets` (déjà lu par le QA). Le champ « Durée max par étape » de la maquette est remplacé par un rappel en lecture seule des durées actuelles (60 min implémentation, 30 min autres étapes) : les rendre réglables par projet toucherait l'exécution, hors 2c.
5. **Contrat de `POST /api/taches` changé** : `{ projet, titre, demande }` ; chemin et budget viennent du projet relié. Projet inconnu = 409.
6. **Détection** affichée comme la maquette mais sans versions ni nombre de tests (il faudrait lire le contenu des fichiers) : « ✓ .NET · Planning.sln · 3 projets (1 de tests) », « ✓ Angular · planning-web/angular.json », « — Aucun devcontainer » n'est pas affiché (non pertinent : l'image de base est toujours utilisée), ligne fixe « Image de base utilisée (SDK .NET, Node, Chrome headless, outils d'analyse) ».

---

## File Structure

Orchestrateur :
- Create `src/taches/projets.ts` — détection d'un dossier, relier / lister / lire un projet.
- Create `src/reseau/panneau.ts` — chargement en mémoire des fichiers construits du front, en-têtes de sécurité.
- Modify `src/db.ts` — table `projets`.
- Modify `src/reseau/serveur-ui.ts` — routes projets, état global, intégrité du journal, nouveau contrat de création, service des fichiers statiques.
- Modify `src/orchestrateur.ts` — câblage des routes, document `analyse` dans la fiche, chargement du panneau, `urlPanneau`.
- Modify `src/pipeline/ordonnanceur.ts` — lecture de l'état suspendu.
- Modify `src/index.ts` — affiche le lien avec le jeton.
- Tests : `test/taches/projets.test.ts`, `test/reseau/panneau.test.ts`, `test/reseau/serveur-ui.test.ts`, `test/orchestrateur.test.ts`, `test/pipeline/ordonnanceur.test.ts` (si le fichier existe ; sinon le test va dans le fichier qui teste l'ordonnanceur).

Front (`web/`, généré par Angular CLI puis réduit) :
- `web/src/app/modeles.ts` — types des réponses de l'API.
- `web/src/app/jeton.ts` — extraction et stockage du jeton.
- `web/src/app/api.ts` — `ApiService` (HttpClient + en-tête `Authorization`).
- `web/src/app/etat.ts` — `EtatBureau` : signaux tâches / escalades / projets / état global, interrogation.
- `web/src/app/libelles.ts` — libellés d'étapes, « qui », essai, budget.
- `web/src/app/app.ts` — coquille (en-tête, navigation, arrêt global).
- `web/src/app/hall/hall.ts`, `web/src/app/hall/relier-projet.ts`, `web/src/app/hall/nouvelle-story.ts`.
- `web/src/app/tache/tache.ts`, `web/src/app/tache/rapport.ts`.
- `web/src/app/securite/securite.ts`, `web/src/app/securite/journal.ts`.
- `web/src/styles.css` — thème sombre de la maquette.
- Tests `*.spec.ts` à côté de chaque fichier.

Racine : `package.json` (scripts `web:build`, `test:web`), `.gitignore`, `CLAUDE.md` (section Commandes), `README.md` (lancement).

---

### Task 1: Projets reliés côté orchestrateur

**Files:**
- Create: `src/taches/projets.ts`
- Modify: `src/db.ts` (schéma)
- Test: `test/taches/projets.test.ts`

**Interfaces:**
- Consumes: `definirSeuils(db, projet, { couvertureLignes })`, `lireSeuils(db, projet, defaut)` (`src/taches/seuils.ts`), `enTransaction(db, fn)` (`src/db.ts`).
- Produces:
  - `type Detection = { chemin: string; nomPropose: string; git: boolean; dotnet: { solution: string | null; projets: number; projetsTests: number } | null; angular: { fichier: string } | null }`
  - `type Projet = { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number; relieLe: string }`
  - `detecterProjet(chemin: string): Detection` — lève `Error('chemin absolu attendu')` ou `Error('dossier introuvable : <chemin>')`.
  - `relierProjet(db: Base, p: { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number }): Projet`
  - `listerProjets(db: Base, couvertureDefaut: number): Projet[]` (tri par nom)
  - `lireProjet(db: Base, nom: string, couvertureDefaut: number): Projet | null`

- [ ] **Step 1: Schéma.** Dans la constante `SCHEMA` de `src/db.ts`, après `seuils_projets`, ajouter :

```sql
CREATE TABLE IF NOT EXISTS projets (
  nom TEXT PRIMARY KEY, chemin TEXT NOT NULL UNIQUE, budget_usd REAL NOT NULL, relie_le TEXT NOT NULL
);
```

- [ ] **Step 2: Tests qui échouent** — `test/taches/projets.test.ts` :

```ts
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
```

- [ ] **Step 3: Vérifier l'échec.** Run: `node --disable-warning=ExperimentalWarning --test test/taches/projets.test.ts` — Expected: FAIL (module introuvable).

- [ ] **Step 4: Implémentation** — `src/taches/projets.ts` :

```ts
import fs from 'node:fs';
import path from 'node:path';
import { enTransaction, type Base } from '../db.ts';
import { definirSeuils, lireSeuils } from './seuils.ts';

export type Detection = {
  chemin: string; nomPropose: string; git: boolean;
  dotnet: { solution: string | null; projets: number; projetsTests: number } | null;
  angular: { fichier: string } | null;
};
export type Projet = { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number; relieLe: string };

const IGNORES = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', '.angular']);
const PROFONDEUR_MAX = 4;
const ENTREES_MAX = 10_000;
const NOM = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;

// Noms de fichiers seulement : le contenu du dossier est de la donnée et n'est jamais lu ; aucun lien symbolique suivi.
export function detecterProjet(chemin: string): Detection {
  if (!path.isAbsolute(chemin)) throw new Error('chemin absolu attendu');
  const stat = fs.lstatSync(chemin, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) throw new Error(`dossier introuvable : ${chemin}`);
  const solutions: string[] = [];
  const csproj: string[] = [];
  const angular: string[] = [];
  let vus = 0;
  const file: [string, number][] = [['', 0]];
  while (file.length && vus < ENTREES_MAX) {
    const [rel, niveau] = file.shift()!;
    for (const e of fs.readdirSync(path.join(chemin, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++vus > ENTREES_MAX) break;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!IGNORES.has(e.name) && niveau + 1 < PROFONDEUR_MAX) file.push([r, niveau + 1]); continue; }
      if (!e.isFile()) continue;
      if (/\.slnx?$/i.test(e.name)) solutions.push(r);
      else if (/\.csproj$/i.test(e.name)) csproj.push(e.name);
      else if (e.name === 'angular.json') angular.push(r);
    }
  }
  return {
    chemin, nomPropose: path.basename(chemin), git: fs.existsSync(path.join(chemin, '.git')),
    dotnet: solutions.length || csproj.length
      ? { solution: solutions[0] ?? null, projets: csproj.length, projetsTests: csproj.filter(n => /tests?\.csproj$/i.test(n)).length }
      : null,
    angular: angular.length ? { fichier: angular[0] } : null,
  };
}

type Ligne = { nom: string; chemin: string; budget_usd: number; relie_le: string };
const versProjet = (db: Base, l: Ligne, defaut: number): Projet =>
  ({ nom: l.nom, chemin: l.chemin, budgetUsd: l.budget_usd, couvertureLignes: lireSeuils(db, l.nom, defaut).couvertureLignes, relieLe: l.relie_le });

export function relierProjet(db: Base, p: { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number }): Projet {
  if (!NOM.test(p.nom)) throw new Error('nom de projet invalide (lettres, chiffres, espace, . _ -, 60 caractères au plus)');
  if (!Number.isFinite(p.budgetUsd) || p.budgetUsd <= 0) throw new Error('budget par tâche attendu : nombre positif');
  const d = detecterProjet(p.chemin);
  if (!d.git) throw new Error(`${p.chemin} n’est pas un dépôt Git`);
  if (!d.dotnet && !d.angular) throw new Error(`${p.chemin} : aucune stack .NET ou Angular détectée`);
  return enTransaction(db, () => {
    if (db.prepare('SELECT 1 FROM projets WHERE nom = ? OR chemin = ?').get(p.nom, p.chemin)) throw new Error(`projet déjà relié : ${p.nom}`);
    definirSeuils(db, p.nom, { couvertureLignes: p.couvertureLignes });
    db.prepare('INSERT INTO projets (nom, chemin, budget_usd, relie_le) VALUES (?, ?, ?, ?)').run(p.nom, p.chemin, p.budgetUsd, new Date().toISOString());
    return versProjet(db, db.prepare('SELECT * FROM projets WHERE nom = ?').get(p.nom) as Ligne, p.couvertureLignes);
  });
}

export function listerProjets(db: Base, couvertureDefaut: number): Projet[] {
  return (db.prepare('SELECT * FROM projets ORDER BY nom').all() as Ligne[]).map(l => versProjet(db, l, couvertureDefaut));
}

export function lireProjet(db: Base, nom: string, couvertureDefaut: number): Projet | null {
  const l = db.prepare('SELECT * FROM projets WHERE nom = ?').get(nom) as Ligne | undefined;
  return l ? versProjet(db, l, couvertureDefaut) : null;
}
```

Vérifier dans `src/db.ts` que `enTransaction` renvoie la valeur de `fn` et annule tout si `fn` lève (sinon adapter l'appel, pas le test « un seuil invalide ne laisse aucun projet enregistré »). Si `ouvrirBase(':memory:')` n'est pas accepté, utiliser un fichier temporaire comme les autres tests de `test/taches/`.

- [ ] **Step 5: Vérifier.** Run: `node --disable-warning=ExperimentalWarning --test test/taches/projets.test.ts` puis `npm test` et `npm run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit** — `git add src/db.ts src/taches/projets.ts test/taches/projets.test.ts && git commit -m "Projets reliés : détection du dossier, seuils et budget par projet"`

---

### Task 2: Routes de l'API pour le panneau

**Files:**
- Modify: `src/reseau/serveur-ui.ts`, `src/orchestrateur.ts`, `src/pipeline/ordonnanceur.ts`
- Test: `test/reseau/serveur-ui.test.ts`, `test/orchestrateur.test.ts`, test de l'ordonnanceur

**Interfaces:**
- Consumes: Task 1 (`detecterProjet`, `relierProjet`, `listerProjets`, `lireProjet`), `verifierJournal(db, cle)` (lève si la chaîne est rompue).
- Produces (routes, toutes derrière `Host` + `Origin` + `Bearer`) :
  - `GET /api/etat` → `{ ordonnanceur: 'actif' | 'suspendu' }`
  - `GET /api/projets` → `Projet[]`
  - `POST /api/projets/detection` `{ chemin }` → `Detection` ; chemin non absolu = 400 ; erreur de détection = 409 `{ erreur }`.
  - `POST /api/projets` `{ nom, chemin, budgetUsd, couvertureLignes }` → `Projet` ; types invalides = 400 ; refus métier = 409 `{ erreur }`.
  - `POST /api/taches` `{ projet, titre, demande }` → `Tache` ; champs vides = 400 ; projet non relié ou préparation impossible = 409 `{ erreur }`.
  - `GET /api/journal/integrite` → `{ intacte: boolean; entrees: number; erreur?: string }`
  - `GET /api/taches/:id` : `documents` contient aussi `analyse`.
  - `RoutesUi` gagne `etat`, `projets`, `detecterProjet`, `relierProjet`, `integriteJournal` ; `creerTache` prend `{ projet: string; titre: string; demande: string }`.
  - Ordonnanceur : `estSuspendu(): boolean`.

- [ ] **Step 1: Ordonnanceur.** Test (dans le fichier qui teste déjà `suspendre`/`reactiver`) : `estSuspendu()` vaut `false`, puis `true` après `suspendre()`, puis `false` après `reactiver()`. Implémentation dans l'objet retourné par l'ordonnanceur : `estSuspendu: () => suspendu,`. Ajouter le membre au type exporté s'il est déclaré à part.

- [ ] **Step 2: Tests de routes qui échouent** — dans `test/reseau/serveur-ui.test.ts`, étendre `monter()` :

```ts
    etat: () => ({ ordonnanceur: 'actif' }),
    projets: () => [{ nom: 'Planning' }],
    detecterProjet: chemin => { if (chemin === '/introuvable') throw new Error('dossier introuvable : /introuvable'); return { chemin }; },
    relierProjet: p => { if (p.nom === 'Doublon') throw new Error('projet déjà relié : Doublon'); relies.push(p); return p; },
    integriteJournal: () => ({ intacte: true, entrees: 3 }),
    creerTache: async t => { if (t.projet === 'Inconnu') throw new Error('projet non relié : Inconnu'); creations.push(t); return { id: 'T-42', ...t }; },
```

(`relies` déclaré comme `creations`, renvoyé par `monter()`.) Remplacer les tests existants de `POST /api/taches` par le nouveau contrat — même nombre de cas refusés au moins, chacun adapté :

```ts
test('création d’une tâche : projet, titre et demande seulement', async () => {
  const m = await monter();
  const r = await m.appeler('/api/taches', { methode: 'POST', corps: { projet: 'Planning', titre: 'Export PDF', demande: 'Exporter la fiche', cheminProjet: '/etc', budgetUsd: 999, id: 'T-1' } });
  assert.equal(r.statut, 200);
  assert.deepEqual(m.creations, [{ projet: 'Planning', titre: 'Export PDF', demande: 'Exporter la fiche' }]);
  for (const corps of [{ projet: 'Planning', titre: ' ', demande: 'x' }, { projet: 'Planning', titre: 'x' }, { projet: 3, titre: 'x', demande: 'y' }])
    assert.equal((await m.appeler('/api/taches', { methode: 'POST', corps })).statut, 400);
  assert.deepEqual(await m.appeler('/api/taches', { methode: 'POST', corps: { projet: 'Inconnu', titre: 'x', demande: 'y' } }), { statut: 409, corps: { erreur: 'projet non relié : Inconnu' } });
  m.fermer();
});

test('projets : liste, détection, liaison', async () => {
  const m = await monter();
  assert.deepEqual((await m.appeler('/api/projets')).corps, [{ nom: 'Planning' }]);
  assert.deepEqual(await m.appeler('/api/projets/detection', { methode: 'POST', corps: { chemin: '/depots/planning' } }), { statut: 200, corps: { chemin: '/depots/planning' } });
  assert.equal((await m.appeler('/api/projets/detection', { methode: 'POST', corps: { chemin: 'relatif' } })).statut, 400);
  assert.deepEqual(await m.appeler('/api/projets/detection', { methode: 'POST', corps: { chemin: '/introuvable' } }), { statut: 409, corps: { erreur: 'dossier introuvable : /introuvable' } });
  const ok = { nom: 'Planning', chemin: '/depots/planning', budgetUsd: 6, couvertureLignes: 80 };
  assert.equal((await m.appeler('/api/projets', { methode: 'POST', corps: { ...ok, extra: 1 } })).statut, 200);
  assert.deepEqual(m.relies, [ok]);
  for (const corps of [{ ...ok, chemin: 'relatif' }, { ...ok, budgetUsd: '6' }, { ...ok, couvertureLignes: 80.5 }, { ...ok, nom: '' }])
    assert.equal((await m.appeler('/api/projets', { methode: 'POST', corps })).statut, 400);
  assert.equal((await m.appeler('/api/projets', { methode: 'POST', corps: { ...ok, nom: 'Doublon' } })).statut, 409);
  m.fermer();
});

test('état global et intégrité du journal', async () => {
  const m = await monter();
  assert.deepEqual((await m.appeler('/api/etat')).corps, { ordonnanceur: 'actif' });
  assert.deepEqual((await m.appeler('/api/journal/integrite')).corps, { intacte: true, entrees: 3 });
  m.fermer();
});

test('les nouvelles routes exigent le jeton', async () => {
  const m = await monter();
  for (const chemin of ['/api/etat', '/api/projets', '/api/journal/integrite'])
    assert.equal((await m.appeler(chemin, { entetes: { authorization: 'Bearer faux' } })).statut, 401);
  m.fermer();
});
```

Run: `node --disable-warning=ExperimentalWarning --test test/reseau/serveur-ui.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implémentation des routes** dans `src/reseau/serveur-ui.ts`. Type :

```ts
export type RoutesUi = {
  taches: () => unknown;
  journal: (tacheId: string | null) => unknown;
  integriteJournal: () => unknown;
  escalades: () => unknown;
  deciderEscalade: (id: number, decision: 'approuver' | 'refuser', commentaire: string) => unknown;
  arretGlobal: () => Promise<unknown>;
  /** Réactive l'ordonnanceur suspendu par l'arrêt global ; les tâches restent en pause. */
  repriseGlobale: () => unknown;
  etat: () => unknown;
  projets: () => unknown;
  detecterProjet: (chemin: string) => unknown;
  relierProjet: (p: { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number }) => unknown;
  tache: (id: string) => unknown;
  creerTache: (t: { projet: string; titre: string; demande: string }) => Promise<unknown>;
  action: (id: string, nom: NomAction, corps: Record<string, unknown>) => unknown;
};
```

Ajouter une aide qui transforme une erreur métier en 409 :

```ts
async function conflit(res: http.ServerResponse, fn: () => unknown): Promise<void> {
  try {
    repondreJson(res, 200, await fn());
  } catch (e) {
    repondreJson(res, 409, { erreur: (e as Error).message });
  }
}
const texte = (v: unknown) => typeof v === 'string' && v.trim() !== '';
```

Routes (avant le `404` final ; `/api/journal/integrite` avant `/api/journal`) :

```ts
  if (req.method === 'GET' && url.pathname === '/api/journal/integrite') return repondreJson(res, 200, routes.integriteJournal());
  if (req.method === 'GET' && url.pathname === '/api/etat') return repondreJson(res, 200, routes.etat());
  if (req.method === 'GET' && url.pathname === '/api/projets') return repondreJson(res, 200, routes.projets());
  if (req.method === 'POST' && url.pathname === '/api/projets/detection') {
    const c = await lireObjet(req);
    if (!c || typeof c.chemin !== 'string' || !path.isAbsolute(c.chemin)) return repondreJson(res, 400, { erreur: 'attendu : chemin absolu' });
    const chemin = c.chemin;
    return conflit(res, () => routes.detecterProjet(chemin));
  }
  if (req.method === 'POST' && url.pathname === '/api/projets') {
    const c = await lireObjet(req);
    const ok = c && texte(c.nom) && typeof c.chemin === 'string' && path.isAbsolute(c.chemin)
      && typeof c.budgetUsd === 'number' && Number.isFinite(c.budgetUsd) && c.budgetUsd > 0
      && Number.isInteger(c.couvertureLignes) && (c.couvertureLignes as number) >= 0 && (c.couvertureLignes as number) <= 100;
    if (!c || !ok) return repondreJson(res, 400, { erreur: 'attendu : nom, chemin absolu, budgetUsd > 0, couvertureLignes entier de 0 à 100' });
    const { nom, chemin, budgetUsd, couvertureLignes } = c as Parameters<RoutesUi['relierProjet']>[0];
    return conflit(res, () => routes.relierProjet({ nom, chemin, budgetUsd, couvertureLignes }));
  }
```

Remplacer le bloc `POST /api/taches` :

```ts
  if (req.method === 'POST' && url.pathname === '/api/taches') {
    const c = await lireObjet(req);
    if (!c || !['projet', 'titre', 'demande'].every(k => texte(c[k]))) return repondreJson(res, 400, { erreur: 'attendu : projet, titre, demande' });
    // Objet explicite : chemin, budget et identifiant viennent de l'orchestrateur, jamais du corps.
    const { projet, titre, demande } = c as Parameters<RoutesUi['creerTache']>[0];
    return conflit(res, () => routes.creerTache({ projet, titre, demande }));
  }
```

- [ ] **Step 4: Câblage** dans `src/orchestrateur.ts` (objet passé à `creerServeurUi`) :

```ts
    etat: () => ({ ordonnanceur: ordonnanceur.estSuspendu() ? 'suspendu' : 'actif' }),
    projets: () => listerProjets(db, config.seuilCouvertureLignes),
    detecterProjet: chemin => detecterProjet(chemin),
    relierProjet: p => relierProjet(db, p),
    integriteJournal: () => {
      const entrees = (db.prepare('SELECT COUNT(*) AS n FROM journal').get() as { n: number }).n;
      try {
        verifierJournal(db, cle);
        return { intacte: true, entrees };
      } catch (e) {
        return { intacte: false, entrees, erreur: (e as Error).message };
      }
    },
    creerTache: ({ projet, titre, demande }) => {
      const p = lireProjet(db, projet, config.seuilCouvertureLignes);
      if (!p) throw new Error(`projet non relié : ${projet}`);
      return creerTacheAvecDemande({ projet: p.nom, titre, demande, cheminProjet: p.chemin, budgetUsd: p.budgetUsd });
    },
```

Si `ordonnanceur` est déclaré après la création du serveur, la fermeture lit sa valeur à l'appel : vérifier l'ordre et le garder ainsi. Dans la route `tache`, ajouter `'analyse'` à la liste des types de documents. La fonction interne `creerTache` exposée par `demarrerOrchestrateur` ne change pas (tests Docker).

- [ ] **Step 5: Test d'orchestrateur.** Dans `test/orchestrateur.test.ts` (qui démarre l'orchestrateur avec des doublures : suivre son motif existant), ajouter : `POST /api/taches` avec un projet non relié répond 409 `projet non relié : X` et ne crée aucune tâche ; `GET /api/etat` passe de `actif` à `suspendu` après `POST /api/arret-global`, puis à `actif` après `POST /api/reprise-globale` ; `GET /api/journal/integrite` répond `intacte: true` sur une base neuve. Si ce fichier ne monte pas le serveur UI, mettre ces tests dans le fichier qui le fait et le signaler.

- [ ] **Step 6: Vérifier.** `npm test`, `npm run typecheck` — Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -am "API du panneau : projets reliés, état global, intégrité du journal, création par projet"` (ajouter les nouveaux fichiers de test s'il y en a).

---

### Task 3: Le serveur UI sert le panneau

**Files:**
- Create: `src/reseau/panneau.ts`
- Modify: `src/reseau/serveur-ui.ts`, `src/orchestrateur.ts`, `src/index.ts`
- Test: `test/reseau/panneau.test.ts`, `test/reseau/serveur-ui.test.ts`

**Interfaces:**
- Produces:
  - `type FichierPanneau = { contenu: Buffer; type: string }`
  - `chargerPanneau(dossier: string): Map<string, FichierPanneau> | null` — `null` si `dossier/index.html` n'existe pas ; clés `/<chemin posix relatif>` ; extensions inconnues ignorées ; liens symboliques ignorés.
  - `ENTETES_PANNEAU: Record<string, string>` (CSP et autres).
  - `creerServeurUi(jetonSession, routes, panneau: Map<string, FichierPanneau> | null = null)`.
  - `demarrerOrchestrateur` renvoie aussi `urlPanneau: string` = `${urlUi}/#jeton=${jetonSession}`.

- [ ] **Step 1: Tests qui échouent** — `test/reseau/panneau.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chargerPanneau } from '../../src/reseau/panneau.ts';

function construit(fichiers: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'panneau-'));
  for (const [f, c] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
}

test('charge les fichiers connus avec leur type', () => {
  const p = chargerPanneau(construit({ 'index.html': '<html>', 'main-AB12.js': 'x', 'styles-CD34.css': 'y', 'media/logo.svg': '<svg/>', 'notes.exe': 'z' }))!;
  assert.deepEqual([...p.keys()].sort(), ['/index.html', '/main-AB12.js', '/media/logo.svg', '/styles-CD34.css']);
  assert.equal(p.get('/index.html')!.type, 'text/html; charset=utf-8');
  assert.equal(p.get('/main-AB12.js')!.type, 'text/javascript; charset=utf-8');
});

test('panneau absent sans index.html', () => {
  assert.equal(chargerPanneau(construit({ 'main.js': 'x' })), null);
  assert.equal(chargerPanneau('/n/existe/pas'), null);
});

test('liens symboliques ignorés', () => {
  const d = construit({ 'index.html': '<html>' });
  fs.symlinkSync('/etc/hostname', path.join(d, 'fuite.txt'));
  assert.equal(chargerPanneau(d)!.has('/fuite.txt'), false);
});
```

Dans `test/reseau/serveur-ui.test.ts`, `monter()` accepte un panneau optionnel (troisième argument de `creerServeurUi`) et `appeler` renvoie aussi les en-têtes et le corps brut quand ce n'est pas du JSON (ajouter un champ `entetes` et un champ `brut` au résultat ; ne pas changer les assertions existantes, qui comparent `statut` et `corps` : `corps` reste le JSON analysé quand le type est `application/json`, sinon `null`). Tests :

```ts
const PANNEAU = new Map([
  ['/index.html', { contenu: Buffer.from('<html>panneau</html>'), type: 'text/html; charset=utf-8' }],
  ['/main-AB12.js', { contenu: Buffer.from('console.log(1)'), type: 'text/javascript; charset=utf-8' }],
]);

test('sert le panneau sans jeton, avec CSP stricte', async () => {
  const m = await monter(PANNEAU);
  const r = await m.appeler('/', { entetes: { authorization: '' } });
  assert.equal(r.statut, 200);
  assert.equal(r.brut, '<html>panneau</html>');
  assert.match(r.entetes['content-security-policy'] as string, /default-src 'self'.*frame-ancestors 'none'/);
  assert.equal(r.entetes['x-content-type-options'], 'nosniff');
  assert.equal(r.entetes['x-frame-options'], 'DENY');
  assert.equal(r.entetes['referrer-policy'], 'no-referrer');
  assert.equal((await m.appeler('/main-AB12.js', { entetes: { authorization: '' } })).brut, 'console.log(1)');
  m.fermer();
});

test('routes du front renvoient index.html ; fichier inconnu = 404', async () => {
  const m = await monter(PANNEAU);
  assert.equal((await m.appeler('/taches/T-41', { entetes: { authorization: '' } })).brut, '<html>panneau</html>');
  assert.equal((await m.appeler('/absent.js', { entetes: { authorization: '' } })).statut, 404);
  assert.equal((await m.appeler('/../src/index.ts', { entetes: { authorization: '' } })).statut, 404);
  m.fermer();
});

test('panneau : Host étranger refusé, méthode autre que GET refusée', async () => {
  const m = await monter(PANNEAU);
  assert.equal((await m.appeler('/', { entetes: { host: `bureau.evil.example:${m.adresse.port}` } })).statut, 403);
  assert.equal((await m.appeler('/', { methode: 'POST', entetes: { authorization: '' } })).statut, 405);
  m.fermer();
});

test('panneau non construit : message explicite', async () => {
  const m = await monter(null);
  const r = await m.appeler('/', { entetes: { authorization: '' } });
  assert.equal(r.statut, 503);
  assert.match(r.brut, /npm run web:build/);
  m.fermer();
});

test('l’API exige toujours le jeton quand le panneau est servi', async () => {
  const m = await monter(PANNEAU);
  assert.equal((await m.appeler('/api/taches', { entetes: { authorization: '' } })).statut, 401);
  m.fermer();
});
```

Note : `'/../src/index.ts'` est normalisé par `URL` en `/src/index.ts` ; il doit répondre 404 (extension `.ts` absente de la carte), jamais lire le disque.

- [ ] **Step 2: Vérifier l'échec.** Run: `node --disable-warning=ExperimentalWarning --test test/reseau/panneau.test.ts test/reseau/serveur-ui.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implémentation** — `src/reseau/panneau.ts` :

```ts
import fs from 'node:fs';
import path from 'node:path';

export type FichierPanneau = { contenu: Buffer; type: string };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export const ENTETES_PANNEAU: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

// Chargé une fois au démarrage : le serveur ne lit jamais le disque d'après une URL.
export function chargerPanneau(dossier: string): Map<string, FichierPanneau> | null {
  if (!fs.lstatSync(path.join(dossier, 'index.html'), { throwIfNoEntry: false })?.isFile()) return null;
  const fichiers = new Map<string, FichierPanneau>();
  const parcourir = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dossier, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) parcourir(r);
      else if (e.isFile() && TYPES[path.extname(e.name).toLowerCase()])
        fichiers.set(`/${r}`, { contenu: fs.readFileSync(path.join(dossier, r)), type: TYPES[path.extname(e.name).toLowerCase()] });
    }
  };
  parcourir('');
  return fichiers;
}
```

Dans `src/reseau/serveur-ui.ts` : `creerServeurUi(jetonSession, routes, panneau: Map<string, FichierPanneau> | null = null)` passe `panneau` à `traiter`. Dans `traiter`, juste après le contrôle `Host` (avant `Origin` et jeton) :

```ts
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return servirPanneau(panneau, req, res, url.pathname);
```

(la ligne `const url = …` existante plus bas est supprimée.)

```ts
function servirPanneau(panneau: Map<string, FichierPanneau> | null, req: http.IncomingMessage, res: http.ServerResponse, chemin: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET', ...ENTETES_PANNEAU }); res.end(); return; }
  if (!panneau) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', ...ENTETES_PANNEAU });
    res.end('Panneau non construit : lancer npm run web:build, puis redémarrer le bureau.');
    return;
  }
  // Une route du front (sans extension) reçoit index.html ; un fichier absent de la carte n'existe pas.
  const f = panneau.get(chemin) ?? (path.posix.extname(chemin) === '' ? panneau.get('/index.html') : undefined);
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...ENTETES_PANNEAU }); res.end('introuvable'); return; }
  res.writeHead(200, { 'content-type': f.type, ...ENTETES_PANNEAU });
  res.end(req.method === 'HEAD' ? undefined : f.contenu);
}
```

Dans `src/orchestrateur.ts` : `const panneau = chargerPanneau(path.join(racineDepot, 'web', 'dist', 'web', 'browser'));` passé en troisième argument ; ajouter `urlPanneau: \`http://127.0.0.1:${config.portUi}/#jeton=${jetonSession}\`` à l'objet retourné (et au type de retour s'il est déclaré). Dans `src/index.ts`, remplacer les deux `console.log` par :

```ts
  console.log(`Bureau d'agents prêt : ouvre ${o.urlPanneau}`);
  console.log('Le lien contient le jeton de session : ne le partage pas.');
```

- [ ] **Step 4: Vérifier.** `npm test`, `npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/reseau/panneau.ts test/reseau/panneau.test.ts && git commit -am "Serveur UI : sert le panneau construit sous CSP stricte, lien avec jeton au démarrage"`

---

### Task 4: Squelette Angular, jeton, API et état

**Files:**
- Create: `web/` (Angular CLI), `web/src/app/{modeles,jeton,api,etat,libelles}.ts` et leurs `.spec.ts`, `web/src/app/app.ts`, `web/src/app/app.routes.ts`, `web/src/styles.css`
- Modify: `package.json` (scripts), `.gitignore`, `tsconfig.json` racine si nécessaire

**Interfaces:**
- Produces (utilisées par les tâches 5 à 7) :
  - `modeles.ts` : types ci-dessous.
  - `lireJeton(hash: string, stockage: Pick<Storage, 'getItem' | 'setItem'>): string | null`
  - `ApiService` (injectable racine) : méthodes listées ci-dessous, toutes `Promise`.
  - `EtatBureau` (injectable racine) : signaux `taches`, `escalades`, `projets`, `etat`, `erreur` ; `rafraichir(): Promise<void>` ; `demarrer(): void` ; `arreter(): void`.
  - `libelles.ts` : `ETAPES`, `LIBELLE_ETAPE`, `qui(t)`, `essai(t)`, `budget(t)`, `eur(n)`.

- [ ] **Step 1: Génération.** À la racine :

```bash
export npm_config_script_shell=/bin/bash
npx --yes @angular/cli@21.2.29 new web --directory web --skip-git --skip-install --style=css --routing --ssr=false --zoneless --test-runner=vitest --ai-config=none --defaults
```

Si une option n'existe pas dans cette version (`npx @angular/cli@21.2.29 new --help`), la retirer et obtenir le même résultat (pas de SSR, sans zone.js, Vitest). Puis dans `web/package.json` : fixer chaque version exactement (voir Global Constraints ; `npm view <paquet>@<plage> version` pour la dernière de la plage), ajouter `jsdom` en devDependency si absent, et `cd web && npm install` pour produire `web/package-lock.json`. Dans `web/angular.json`, configuration `production` : `"optimization": { "scripts": true, "styles": { "minify": true, "inlineCritical": false }, "fonts": false }` (le CSS critique en ligne utilise un attribut `onload` que la CSP refuse ; `fonts: false` évite tout appel à Google Fonts). Supprimer le contenu de démonstration de `app.html`/`app.css` générés (les composants de ce plan ont leur gabarit en ligne).

- [ ] **Step 2: Scripts et exclusions.** `package.json` racine, section `scripts` :

```json
    "web:build": "npm --prefix web run build",
    "test:web": "npm --prefix web test -- --watch=false"
```

`.gitignore` : ajouter `web/dist/` et `web/.angular/`. Vérifier que `tsconfig.json` racine n'inclut pas `web/` (`include` = `src`, `test`, `test-docker`, `scripts` : rien à faire) et que `npm test` racine ne ramasse aucun `web/**` (motif `test/**/*.test.ts` : rien à faire).

- [ ] **Step 3: Tests qui échouent** — `web/src/app/jeton.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { lireJeton } from './jeton';

const stockage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe('lireJeton', () => {
  it('prend le jeton du fragment et le range', () => {
    const s = stockage();
    expect(lireJeton('#jeton=abc_DEF-123', s)).toBe('abc_DEF-123');
    expect(s.m.get('jeton')).toBe('abc_DEF-123');
  });
  it('sans fragment, relit le jeton rangé', () => {
    const s = stockage();
    s.setItem('jeton', 'range');
    expect(lireJeton('', s)).toBe('range');
  });
  it('refuse un jeton de forme inattendue', () => {
    expect(lireJeton('#jeton=<script>', stockage())).toBeNull();
  });
});
```

`web/src/app/libelles.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { budget, essai, eur, qui } from './libelles';
import type { Tache } from './modeles';

const t = (x: Partial<Tache>): Tache => ({ id: 'T-41', projet: 'Film', titre: 'Export PDF', cheminProjet: '/p', etape: 'implementation', statut: 'en_cours', raison: null, echangesPlan: 0, essaisQa: 0, budgetUsd: 6, depenseUsd: 2.35, agent: 'implementeur', ...x });

describe('libellés du kanban', () => {
  it('format monétaire de la maquette', () => expect(eur(5.9)).toBe('5,90 $'));
  it('budget consommé / plafond', () => expect(budget(t({}))).toBe('2,35 $ / 6,00 $'));
  it('essai seulement après le patron (plan)', () => {
    expect(essai(t({ etape: 'cadrage' }))).toBe('');
    expect(essai(t({ etape: 'implementation', essaisQa: 1 }))).toBe('essai 2/3');
  });
  it('qui travaille, ou qui attend', () => {
    expect(qui(t({}))).toBe('Implémenteur');
    expect(qui(t({ etape: 'cadrage', statut: 'attente_humain', agent: 'cadreur', raison: 'le cadreur attend ta réponse' }))).toBe('Cadreur · t’attend');
    expect(qui(t({ etape: 'validation', statut: 'attente_humain' }))).toBe('Toi · à valider');
    expect(qui(t({ statut: 'en_pause', raison: 'budget : plafond atteint' }))).toBe('Implémenteur · budget dépassé');
    expect(qui(t({ statut: 'en_pause', raison: 'escalade : npm install x' }))).toBe('Implémenteur · en pause');
    expect(qui(t({ statut: 'bloquee', raison: '3 no-go' }))).toBe('Bloquée · 3 no-go');
    expect(qui(t({ statut: 'prete', agent: null }))).toBe('En file');
  });
});
```

`web/src/app/api.spec.ts` (HttpClient de test) :

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiService, JETON } from './api';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: JETON, useValue: 'jeton-test' }] });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  it('envoie le jeton dans l’en-tête Authorization', async () => {
    const p = api.taches();
    const req = http.expectOne('/api/taches');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-test');
    req.flush([]);
    expect(await p).toEqual([]);
  });

  it('crée une tâche avec projet, titre et demande seulement', async () => {
    const p = api.creerTache({ projet: 'Film', titre: 'Export', demande: 'Exporter' });
    const req = http.expectOne('/api/taches');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ projet: 'Film', titre: 'Export', demande: 'Exporter' });
    req.flush({ id: 'T-42' });
    await p;
  });

  it('remonte le message d’erreur du serveur', async () => {
    const p = api.action('T-41', 'reprise', {});
    http.expectOne('/api/taches/T-41/reprise').flush({ erreur: 'T-41 ne se reprend pas ainsi' }, { status: 409, statusText: 'Conflict' });
    await expect(p).rejects.toThrow('T-41 ne se reprend pas ainsi');
  });
});
```

`web/src/app/etat.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api';
import { EtatBureau } from './etat';

describe('EtatBureau', () => {
  const api = { taches: vi.fn(), escalades: vi.fn(), projets: vi.fn(), etat: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    api.taches.mockResolvedValue([{ id: 'T-41' }]);
    api.escalades.mockResolvedValue([{ id: 1 }]);
    api.projets.mockResolvedValue([{ nom: 'Film' }]);
    api.etat.mockResolvedValue({ ordonnanceur: 'actif' });
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('rafraîchit tout et interroge toutes les 3 s', async () => {
    const e = TestBed.inject(EtatBureau);
    e.demarrer();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.taches()).toEqual([{ id: 'T-41' }]);
    expect(e.escalades()).toEqual([{ id: 1 }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.taches).toHaveBeenCalledTimes(2);
    e.arreter();
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.taches).toHaveBeenCalledTimes(2);
  });

  it('garde le dernier état connu et affiche l’erreur si l’API ne répond plus', async () => {
    const e = TestBed.inject(EtatBureau);
    await e.rafraichir();
    api.taches.mockRejectedValueOnce(new Error('jeton de session requis'));
    await e.rafraichir();
    expect(e.taches()).toEqual([{ id: 'T-41' }]);
    expect(e.erreur()).toBe('jeton de session requis');
  });
});
```

Run: `npm run test:web` — Expected: FAIL (modules absents).

- [ ] **Step 4: Implémentation.**

`web/src/app/modeles.ts` (miroir des réponses de l'orchestrateur ; vérifier chaque champ contre `src/taches/depot.ts`, `src/integrite/journal.ts`, `src/taches/echanges.ts`, `src/analyse/analyse.ts`, `src/taches/projets.ts`) :

```ts
export type Etape = 'cadrage' | 'patron_plan' | 'implementation' | 'review' | 'patron_code' | 'qa' | 'validation';
export type Statut = 'prete' | 'en_cours' | 'en_pause' | 'bloquee' | 'attente_humain' | 'terminee' | 'abandonnee';
export type Tache = {
  id: string; projet: string; titre: string; cheminProjet: string; etape: Etape; statut: Statut; raison: string | null;
  echangesPlan: number; essaisQa: number; budgetUsd: number; depenseUsd: number; agent: string | null;
};
export type Projet = { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number; relieLe: string };
export type Detection = {
  chemin: string; nomPropose: string; git: boolean;
  dotnet: { solution: string | null; projets: number; projetsTests: number } | null;
  angular: { fichier: string } | null;
};
export type EntreeJournal = {
  id: number; tacheId: string; horodatage: string; type: string; outil: string | null; commande: string;
  couche: string; decision: string; decideur: string; raison: string;
};
export type Escalade = { id: number; tacheId: string; outil: string; entree: string; raison: string; creeLe: string };
export type Echange = { auteur: 'cadreur' | 'moi'; texte: string; creeLe: string };
export type Proposition = { spec: string; criteres: string[]; plan: string };
export type TypeDocument = 'demande' | 'spec' | 'criteres' | 'plan' | 'avis_patron' | 'resume' | 'rapport' | 'avis_patron_code' | 'verdict' | 'analyse';
export type FicheTache = {
  tache: Tache; documents?: Record<TypeDocument, string | null>; proposition?: Proposition | null; echanges?: Echange[]; anomalie?: string;
};
export type StatutOutil = 'ok' | 'echec' | 'absent' | 'non_applicable';
export type Analyse = {
  sha: string; base: string; outils: Record<string, StatutOutil>;
  tests: { total: number; echecs: number } | null;
  couverture: { couvertes: number; total: number; pourcentage: number | null; sourcesHorsCouverture: string[] } | null;
  constats: { outil: string; severite: 'critique' | 'haute' | 'moyenne' | 'basse'; message: string; fichier: string | null }[];
  signalements: string[];
};
export type Verdict = {
  qa: { verdict: 'go' | 'no_go'; criteres: { numero: number; rempli: boolean; preuve: string }[] };
  regles: string[]; verdict: 'go' | 'no_go';
};
export type IntegriteJournal = { intacte: boolean; entrees: number; erreur?: string };
export type EtatGlobal = { ordonnanceur: 'actif' | 'suspendu' };
export type NomAction = 'reponse' | 'validation-cadrage' | 'arbitrage' | 'budget' | 'reprise';
```

`web/src/app/jeton.ts` :

```ts
const FORME = /^[A-Za-z0-9_-]{1,128}$/;

// Le jeton arrive dans le fragment (#jeton=…), jamais envoyé au serveur ; il est gardé pour l'onglet seulement.
export function lireJeton(hash: string, stockage: Pick<Storage, 'getItem' | 'setItem'>): string | null {
  const m = /^#jeton=(.+)$/.exec(hash);
  if (m) {
    if (!FORME.test(m[1])) return null;
    stockage.setItem('jeton', m[1]);
    return m[1];
  }
  const range = stockage.getItem('jeton');
  return range && FORME.test(range) ? range : null;
}
```


`web/src/app/api.ts` :

```ts
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type { Detection, EntreeJournal, Escalade, EtatGlobal, FicheTache, IntegriteJournal, NomAction, Projet, Tache } from './modeles';

export const JETON = new InjectionToken<string>('jeton de session');

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly entetes = new HttpHeaders({ Authorization: `Bearer ${inject(JETON)}` });

  private async appel<T>(o: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(o);
    } catch (e) {
      const message = e instanceof HttpErrorResponse ? (e.error?.erreur ?? `${e.status} ${e.statusText}`) : (e as Error).message;
      throw new Error(message);
    }
  }
  private get<T>(url: string) { return this.appel(this.http.get<T>(url, { headers: this.entetes })); }
  private post<T>(url: string, corps: unknown) { return this.appel(this.http.post<T>(url, corps, { headers: this.entetes })); }

  taches() { return this.get<Tache[]>('/api/taches'); }
  tache(id: string) { return this.get<FicheTache>(`/api/taches/${id}`); }
  creerTache(t: { projet: string; titre: string; demande: string }) { return this.post<Tache>('/api/taches', t); }
  action(id: string, nom: NomAction, corps: Record<string, unknown>) { return this.post<Tache>(`/api/taches/${id}/${nom}`, corps); }
  projets() { return this.get<Projet[]>('/api/projets'); }
  detecter(chemin: string) { return this.post<Detection>('/api/projets/detection', { chemin }); }
  relier(p: { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number }) { return this.post<Projet>('/api/projets', p); }
  escalades() { return this.get<Escalade[]>('/api/escalades'); }
  deciderEscalade(id: number, decision: 'approuver' | 'refuser', commentaire: string) { return this.post<unknown>(`/api/escalades/${id}`, { decision, commentaire }); }
  journal(tacheId?: string) { return this.get<EntreeJournal[]>(tacheId ? `/api/journal?tache=${encodeURIComponent(tacheId)}` : '/api/journal'); }
  integrite() { return this.get<IntegriteJournal>('/api/journal/integrite'); }
  etat() { return this.get<EtatGlobal>('/api/etat'); }
  arretGlobal() { return this.post<unknown>('/api/arret-global', {}); }
  repriseGlobale() { return this.post<unknown>('/api/reprise-globale', {}); }
}
```

`web/src/app/etat.ts` :

```ts
import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api';
import type { Escalade, EtatGlobal, Projet, Tache } from './modeles';

@Injectable({ providedIn: 'root' })
export class EtatBureau {
  private readonly api = inject(ApiService);
  private minuteur: ReturnType<typeof setInterval> | undefined;
  readonly taches = signal<Tache[]>([]);
  readonly escalades = signal<Escalade[]>([]);
  readonly projets = signal<Projet[]>([]);
  readonly etat = signal<EtatGlobal>({ ordonnanceur: 'actif' });
  readonly erreur = signal<string | null>(null);

  async rafraichir(): Promise<void> {
    try {
      const [taches, escalades, projets, etat] = await Promise.all([this.api.taches(), this.api.escalades(), this.api.projets(), this.api.etat()]);
      this.taches.set(taches); this.escalades.set(escalades); this.projets.set(projets); this.etat.set(etat);
      this.erreur.set(null);
    } catch (e) {
      this.erreur.set((e as Error).message);
    }
  }
  demarrer(): void {
    void this.rafraichir();
    this.minuteur = setInterval(() => void this.rafraichir(), 3000);
  }
  arreter(): void { clearInterval(this.minuteur); }
}
```

`web/src/app/libelles.ts` :

```ts
import type { Etape, Tache } from './modeles';

export const ETAPES: Etape[] = ['cadrage', 'patron_plan', 'implementation', 'review', 'patron_code', 'qa', 'validation'];
export const LIBELLE_ETAPE: Record<Etape, string> = {
  cadrage: 'Cadrage', patron_plan: 'Patron (plan)', implementation: 'Implémentation', review: 'Review',
  patron_code: 'Patron (code)', qa: 'QA', validation: 'Validation',
};
const AGENTS: Record<string, string> = { cadreur: 'Cadreur', patron: 'Patron', implementeur: 'Implémenteur', reviewer: 'Reviewer', qa: 'QA' };
const AGENT_ETAPE: Record<Etape, string> = {
  cadrage: 'Cadreur', patron_plan: 'Patron', implementation: 'Implémenteur', review: 'Reviewer', patron_code: 'Patron', qa: 'QA', validation: 'Toi',
};

export const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;
export const budget = (t: Tache) => `${eur(t.depenseUsd)} / ${eur(t.budgetUsd)}`;
export const essai = (t: Tache) => (t.etape === 'cadrage' || t.etape === 'patron_plan' ? '' : `essai ${t.essaisQa + 1}/3`);
const raison = (t: Tache) => (t.raison ?? '').split(' : ')[0];

export function qui(t: Tache): string {
  const agent = (t.agent && AGENTS[t.agent]) ?? AGENT_ETAPE[t.etape];
  switch (t.statut) {
    case 'attente_humain': return t.etape === 'validation' ? 'Toi · à valider' : `${agent} · t’attend`;
    case 'en_pause': return raison(t) === 'budget' ? `${agent} · budget dépassé` : `${agent} · en pause`;
    case 'bloquee': return `Bloquée · ${t.raison ?? 'raison inconnue'}`;
    case 'prete': return 'En file';
    case 'terminee': return 'Terminée';
    case 'abandonnee': return 'Abandonnée';
    default: return agent;
  }
}
```

`web/src/app/app.routes.ts` : routes `''` → `Hall` (tâche 5), `'taches/:id'` → `TacheVue` (tâche 6), `'securite'` → `Securite` et `'journal'` → `Journal` (tâche 7), `'**'` → redirection `''`. Dans cette tâche, déclarer seulement `''` avec un composant provisoire `Hall` vide (fichier `web/src/app/hall/hall.ts` avec un gabarit `<h1>Hall d'entrée · Tableau des tâches</h1>`), remplacé à la tâche 5.

`web/src/app/app.config.ts` : `provideZonelessChangeDetection()` (si non généré), `provideRouter(routes)`, `provideHttpClient()`, `{ provide: JETON, useFactory: () => lireJeton(location.hash, sessionStorage) ?? '' }`. Dans `web/src/main.ts`, avant `bootstrapApplication`, effacer le fragment : `if (location.hash.startsWith('#jeton=')) { lireJeton(location.hash, sessionStorage); history.replaceState(null, '', location.pathname + location.search); }` (l'usine de `JETON` relit alors le jeton rangé).

`web/src/app/app.ts` — coquille :

```ts
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService, JETON } from './api';
import { EtatBureau } from './etat';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (!jeton) {
      <main class="vide">
        <h1>Jeton de session manquant</h1>
        <p>Ouvre le lien affiché par l'orchestrateur au démarrage (<code>npm run demarrer</code>).</p>
      </main>
    } @else {
      <header class="barre">
        <strong>Bureau d'agents</strong>
        <nav>
          <a routerLink="/" routerLinkActive="actif" [routerLinkActiveOptions]="{ exact: true }">Hall d'entrée</a>
          <a routerLink="/securite" routerLinkActive="actif">Poste de sécurité
            @if (etat.escalades().length) { <span class="pastille">{{ etat.escalades().length }}</span> }
          </a>
          <a routerLink="/journal" routerLinkActive="actif">Journal des commandes</a>
        </nav>
        @if (etat.etat().ordonnanceur === 'actif') {
          <button class="danger" (click)="confirmation.set('arret')">■ Arrêt global</button>
        } @else {
          <button (click)="confirmation.set('reprise')">▶ Tout reprendre</button>
        }
      </header>
      @if (etat.erreur(); as e) { <p class="alerte">Orchestrateur injoignable : {{ e }}</p> }
      <router-outlet />
      @if (confirmation() === 'arret') {
        <div class="voile"><section class="dialogue">
          <h2>Arrêt global ?</h2>
          <p>Les conteneurs sont stoppés immédiatement et les tâches en cours passent en pause. Rien n'est perdu : spec, plan, branches et rapports sont conservés hors conteneur, et chaque tâche reprendra à sa dernière étape terminée. Aucun repo n'est touché.</p>
          <footer><button (click)="confirmation.set(null)">Annuler</button><button class="danger" (click)="arret()">Tout arrêter</button></footer>
        </section></div>
      }
      @if (confirmation() === 'reprise') {
        <div class="voile"><section class="dialogue">
          <h2>Tout reprendre ?</h2>
          <p>L'ordonnanceur redémarre. Les tâches en pause le restent : reprends chacune depuis son panneau. Les tâches qui attendaient ta décision (escalade, intégrité, budget) restent en attente.</p>
          <footer><button (click)="confirmation.set(null)">Annuler</button><button (click)="reprise()">Reprendre</button></footer>
        </section></div>
      }
    }`,
})
export class App implements OnInit, OnDestroy {
  protected readonly jeton = inject(JETON);
  protected readonly etat = inject(EtatBureau);
  private readonly api = inject(ApiService);
  protected readonly confirmation = signal<'arret' | 'reprise' | null>(null);

  ngOnInit() { if (this.jeton) this.etat.demarrer(); }
  ngOnDestroy() { this.etat.arreter(); }
  protected async arret() { this.confirmation.set(null); await this.api.arretGlobal(); await this.etat.rafraichir(); }
  protected async reprise() { this.confirmation.set(null); await this.api.repriseGlobale(); await this.etat.rafraichir(); }
}
```

Le texte « Tout reprendre ? » diffère de la maquette (« Les conteneurs redémarrent et chaque tâche reprend… ») parce que la reprise globale de 2a ne relance aucune tâche : le texte dit ce que fait le code.

Test `web/src/app/app.spec.ts` : avec `JETON` = `''`, le titre « Jeton de session manquant » s'affiche et `EtatBureau.demarrer` n'est pas appelé ; avec un jeton et `etat` = `actif`, cliquer « ■ Arrêt global » puis « Tout arrêter » appelle `ApiService.arretGlobal` une fois ; « Annuler » ne l'appelle pas. (Doublures `vi.fn()` pour `ApiService` et `EtatBureau`, `provideRouter([])`.)

`web/src/styles.css` — thème sombre de la maquette, polices système :

```css
:root {
  --fond: #0f151b; --panneau: #172029; --carte: #1e2a34; --ligne: #30414f; --texte: #dce6ee; --doux: #8fa3b3;
  --accent: #4fb3c6; --attention: #f2c14e; --ok: #5cc98a; --ko: #e5686b;
  --fd: system-ui, -apple-system, 'Segoe UI', sans-serif; --fm: ui-monospace, 'Cascadia Mono', Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--fond); color: var(--texte); font: 14px/1.45 var(--fd); }
code, pre, .mono { font-family: var(--fm); }
a { color: var(--accent); }
button { font: inherit; color: var(--texte); background: var(--carte); border: 1px solid var(--ligne); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button.principal { background: var(--accent); color: var(--fond); border-color: var(--accent); }
button.danger { border-color: var(--ko); color: var(--ko); }
input, textarea, select { font: inherit; color: var(--texte); background: var(--fond); border: 1px solid var(--ligne); border-radius: 6px; padding: 6px 8px; width: 100%; }
.barre { display: flex; gap: 24px; align-items: center; padding: 10px 20px; background: var(--panneau); border-bottom: 1px solid var(--ligne); }
.barre nav { display: flex; gap: 16px; flex: 1; }
.barre nav a { color: var(--doux); text-decoration: none; }
.barre nav a.actif { color: var(--texte); }
.pastille { background: var(--attention); color: var(--fond); border-radius: 10px; padding: 0 6px; margin-left: 4px; font-weight: 600; }
.alerte { margin: 12px 20px; padding: 8px 12px; border: 1px solid var(--ko); color: var(--ko); border-radius: 6px; }
.voile { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); display: grid; place-items: center; }
.dialogue { background: var(--panneau); border: 1px solid var(--ligne); border-radius: 10px; padding: 20px; width: min(560px, 92vw); max-height: 90vh; overflow: auto; }
.dialogue footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.vide { max-width: 560px; margin: 15vh auto; text-align: center; }
.ecran { padding: 16px 20px; }
.go { color: var(--ok); } .nogo { color: var(--ko); } .doux { color: var(--doux); }
```

- [ ] **Step 5: Vérifier.** `npm run test:web` (PASS), `npm run web:build` (sans erreur ; aucun `onload=` ni `fonts.googleapis` dans `web/dist/web/browser/index.html`), `npm test` racine (PASS).

- [ ] **Step 6: Commit** — `git add web package.json .gitignore && git commit -m "Panneau Angular : squelette, jeton par fragment, API, état interrogé, arrêt global"` (vérifier avant que `web/node_modules`, `web/dist`, `web/.angular` ne sont pas indexés).

---

### Task 5: Hall d'entrée — projets, kanban, relier un projet, nouvelle user story

**Files:**
- Create/replace: `web/src/app/hall/hall.ts`, `web/src/app/hall/relier-projet.ts`, `web/src/app/hall/nouvelle-story.ts` et leurs `.spec.ts`
- Modify: `web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `EtatBureau`, `ApiService`, `libelles.ts`, `modeles.ts` (tâche 4).
- Produces: composant `Hall` (route `''`) ; `RelierProjet` et `NouvelleStory` émettent `fermer` (`output<void>()`).

- [ ] **Step 1: Tests qui échouent.** `hall.spec.ts` (doublure d'`EtatBureau` avec signaux, `provideRouter([])`) :
  - 7 colonnes dans l'ordre `Cadrage`, `Patron (plan)`, `Implémentation`, `Review`, `Patron (code)`, `QA`, `Validation`, chacune avec son nombre de tâches (`Implémentation 2` pour deux tâches en implémentation) ; les tâches `terminee` et `abandonnee` n'apparaissent pas.
  - une carte affiche `Film`, `T-41`, le titre, `qui()`, `essai()` et `budget()`, et son lien mène à `/taches/T-41`.
  - la liste des projets affiche `Film · 2` (nombre de tâches du projet, toutes étapes).
  - sans projet relié : « Le bureau est vide » et le bouton « + Relier un premier projet » ; le bouton « + Nouvelle user story » est absent.
  `relier-projet.spec.ts` (doublure `ApiService`) :
  - saisir `/depots/planning` puis « Détecter » appelle `detecter('/depots/planning')` ; la détection `{ dotnet: { solution: 'Planning.sln', projets: 3, projetsTests: 1 }, angular: { fichier: 'planning-web/angular.json' }, git: true, nomPropose: 'planning' }` affiche `✓ .NET`, `Planning.sln · 3 projets (1 de tests)`, `✓ Angular`, `planning-web/angular.json`, et pré-remplit le nom `planning`, le seuil `80`, le budget `6`.
  - `git: false` affiche « ✕ Pas un dépôt Git » et désactive « Relier le projet » ; aucune stack affiche « ✕ Aucune stack .NET ou Angular » et désactive aussi.
  - « Relier le projet » appelle `relier({ nom: 'planning', chemin: '/depots/planning', budgetUsd: 6, couvertureLignes: 80 })`, rafraîchit `EtatBureau` et émet `fermer` ; une erreur de l'API (`projet déjà relié : planning`) s'affiche dans le dialogue, qui reste ouvert.
  `nouvelle-story.spec.ts` :
  - le sélecteur liste les projets reliés ; « Envoyer au cadreur » est désactivé tant que titre ou description est vide ; il appelle `creerTache({ projet, titre, demande })` puis rafraîchit, émet `fermer` ; une erreur reste affichée.

Run: `npm run test:web` — Expected: FAIL.

- [ ] **Step 2: Implémentation.** `hall.ts` :

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EtatBureau } from '../etat';
import { ETAPES, LIBELLE_ETAPE, budget, essai, qui } from '../libelles';
import { NouvelleStory } from './nouvelle-story';
import { RelierProjet } from './relier-projet';

@Component({
  selector: 'app-hall',
  imports: [RouterLink, RelierProjet, NouvelleStory],
  template: `
    <section class="ecran">
      <h1>Hall d'entrée · Tableau des tâches</h1>
      @if (!etat.projets().length) {
        <div class="vide">
          <h2>Le bureau est vide</h2>
          <p>Aucun projet relié, aucun agent au travail. Relie un premier dossier local (.NET ou Angular) : le bureau détecte la stack, propose les seuils par défaut, et le cadreur pourra prendre ta première user story.</p>
          <button class="principal" (click)="dialogue.set('relier')">+ Relier un premier projet</button>
        </div>
      } @else {
        <div class="projets">
          @for (p of etat.projets(); track p.nom) { <span class="projet">{{ p.nom }} · {{ nombre(p.nom) }}</span> }
          <button (click)="dialogue.set('relier')">+ Relier un projet</button>
          <button class="principal" (click)="dialogue.set('story')">+ Nouvelle user story</button>
        </div>
        <div class="kanban">
          @for (col of colonnes(); track col.etape) {
            <div class="colonne">
              <h3>{{ col.nom }} <span class="doux">{{ col.taches.length }}</span></h3>
              @for (t of col.taches; track t.id) {
                <a class="carte" [routerLink]="['/taches', t.id]">
                  <div class="doux mono">{{ t.projet }} {{ t.id }}</div>
                  <div>{{ t.titre }}</div>
                  <div class="doux">{{ qui(t) }}</div>
                  <div class="doux mono">{{ essai(t) }} {{ budget(t) }}</div>
                </a>
              }
            </div>
          }
        </div>
      }
      @if (dialogue() === 'relier') { <app-relier-projet (fermer)="dialogue.set(null)" /> }
      @if (dialogue() === 'story') { <app-nouvelle-story (fermer)="dialogue.set(null)" /> }
    </section>`,
  styles: `
    .projets { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .projet { padding: 4px 10px; border: 1px solid var(--ligne); border-radius: 14px; }
    .kanban { display: grid; grid-template-columns: repeat(7, minmax(160px, 1fr)); gap: 10px; overflow-x: auto; }
    .colonne { background: var(--panneau); border: 1px solid var(--ligne); border-radius: 8px; padding: 8px; min-height: 200px; }
    .colonne h3 { margin: 0 0 8px; font-size: 13px; }
    .carte { display: block; background: var(--carte); border: 1px solid var(--ligne); border-radius: 6px; padding: 8px; margin-bottom: 8px; color: var(--texte); text-decoration: none; }
  `,
})
export class Hall {
  protected readonly etat = inject(EtatBureau);
  protected readonly dialogue = signal<'relier' | 'story' | null>(null);
  protected readonly qui = qui; protected readonly essai = essai; protected readonly budget = budget;
  protected readonly colonnes = computed(() => {
    const actives = this.etat.taches().filter(t => t.statut !== 'terminee' && t.statut !== 'abandonnee');
    return ETAPES.map(etape => ({ etape, nom: LIBELLE_ETAPE[etape], taches: actives.filter(t => t.etape === etape) }));
  });
  protected nombre(projet: string) { return this.etat.taches().filter(t => t.projet === projet).length; }
}
```


`relier-projet.ts` :

```ts
import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';
import type { Detection } from '../modeles';

@Component({
  selector: 'app-relier-projet',
  imports: [FormsModule],
  template: `
    <div class="voile"><section class="dialogue">
      <h2>Relier un projet</h2>
      <h3>1 · Dossier local</h3>
      <div class="ligne">
        <input [(ngModel)]="chemin" placeholder="/chemin/absolu/du/depot" aria-label="Dossier local" />
        <button (click)="detecter()" [disabled]="!chemin.trim()">Détecter</button>
      </div>
      @if (detection(); as d) {
        <h3>2 · Détection</h3>
        <ul class="detection">
          @if (!d.git) { <li class="nogo">✕ Pas un dépôt Git</li> }
          @if (d.dotnet; as n) { <li class="go">✓ .NET <span class="doux">{{ n.solution ?? 'sans solution' }} · {{ n.projets }} projets ({{ n.projetsTests }} de tests)</span></li> }
          @if (d.angular; as a) { <li class="go">✓ Angular <span class="doux">{{ a.fichier }}</span></li> }
          @if (!d.dotnet && !d.angular) { <li class="nogo">✕ Aucune stack .NET ou Angular</li> }
          <li class="doux">Image de base utilisée (SDK .NET, Node, Chrome headless, outils d'analyse)</li>
        </ul>
        <h3>3 · Réglages du projet</h3>
        <label>Nom <input [(ngModel)]="nom" /></label>
        <label>Seuil de couverture (lignes modifiées) <input type="number" min="0" max="100" step="1" [(ngModel)]="seuil" /> %</label>
        <label>Budget par tâche <input type="number" min="0.5" step="0.5" [(ngModel)]="budget" /> $</label>
        <p class="doux">Durée max par étape : 60 min pour l'implémentation, 30 min pour les autres étapes.</p>
        <p class="doux">Au-delà du budget, la tâche s'arrête et demande ton accord. Au-delà de la durée, elle passe en « bloquée ».</p>
      }
      @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
      <footer>
        <button (click)="fermer.emit()">Annuler</button>
        <button class="principal" (click)="relier()" [disabled]="!relieable()">Relier le projet</button>
      </footer>
    </section></div>`,
  styles: `.ligne { display: flex; gap: 8px; } label { display: block; margin: 8px 0; } .detection { list-style: none; padding: 0; }`,
})
export class RelierProjet {
  private readonly api = inject(ApiService);
  private readonly etat = inject(EtatBureau);
  readonly fermer = output<void>();
  protected chemin = '';
  protected nom = '';
  protected seuil = 80;
  protected budget = 6;
  protected readonly detection = signal<Detection | null>(null);
  protected readonly erreur = signal<string | null>(null);

  protected relieable() {
    const d = this.detection();
    return !!d && d.git && (!!d.dotnet || !!d.angular) && this.nom.trim() !== '';
  }
  protected async detecter() {
    this.erreur.set(null);
    try {
      const d = await this.api.detecter(this.chemin.trim());
      this.detection.set(d);
      this.nom = d.nomPropose;
    } catch (e) { this.detection.set(null); this.erreur.set((e as Error).message); }
  }
  protected async relier() {
    this.erreur.set(null);
    try {
      await this.api.relier({ nom: this.nom.trim(), chemin: this.chemin.trim(), budgetUsd: Number(this.budget), couvertureLignes: Number(this.seuil) });
      await this.etat.rafraichir();
      this.fermer.emit();
    } catch (e) { this.erreur.set((e as Error).message); }
  }
}
```

Le seuil par défaut affiché (80) est la valeur par défaut de la configuration ; si `GET /api/projets` ne la fournit pas, garder 80 en dur ici (c'est la valeur par défaut de la spec), sans l'envoyer autrement que dans le corps de `POST /api/projets`.

`nouvelle-story.ts` :

```ts
import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';

@Component({
  selector: 'app-nouvelle-story',
  imports: [FormsModule],
  template: `
    <div class="voile"><section class="dialogue">
      <h2>Nouvelle user story</h2>
      <label>Projet
        <select [(ngModel)]="projet">
          @for (p of etat.projets(); track p.nom) { <option [value]="p.nom">{{ p.nom }}</option> }
        </select>
      </label>
      <label>Titre <input [(ngModel)]="titre" /></label>
      <label>Description libre <textarea rows="8" [(ngModel)]="demande"></textarea></label>
      <p class="doux">Le cadreur part d'un contexte vierge : il lit le repo, ta demande et la maquette éventuelle, puis te propose spec.md et plan.md.</p>
      @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
      <footer>
        <button (click)="fermer.emit()">Annuler</button>
        <button class="principal" [disabled]="envoi() || !projet || !titre.trim() || !demande.trim()" (click)="envoyer()">Envoyer au cadreur</button>
      </footer>
    </section></div>`,
  styles: `label { display: block; margin: 8px 0; }`,
})
export class NouvelleStory {
  private readonly api = inject(ApiService);
  protected readonly etat = inject(EtatBureau);
  readonly fermer = output<void>();
  protected projet = this.etat.projets()[0]?.nom ?? '';
  protected titre = '';
  protected demande = '';
  protected readonly envoi = signal(false);
  protected readonly erreur = signal<string | null>(null);

  protected async envoyer() {
    this.envoi.set(true);
    this.erreur.set(null);
    try {
      await this.api.creerTache({ projet: this.projet, titre: this.titre.trim(), demande: this.demande.trim() });
      await this.etat.rafraichir();
      this.fermer.emit();
    } catch (e) { this.erreur.set((e as Error).message); } finally { this.envoi.set(false); }
  }
}
```

(« Envoyer au cadreur » est désactivé pendant l'envoi : la préparation de l'espace — clone dans un volume — prend plusieurs secondes.)

- [ ] **Step 3: Vérifier.** `npm run test:web` (PASS), `npm run web:build`.

- [ ] **Step 4: Commit** — `git add web && git commit -m "Panneau : hall d'entrée, kanban, relier un projet, nouvelle user story"`

---

### Task 6: Panneau d'une tâche — documents, cadreur, arbitrage, reprise, rapport

**Files:**
- Create: `web/src/app/tache/tache.ts`, `web/src/app/tache/rapport.ts` et leurs `.spec.ts`
- Modify: `web/src/app/app.routes.ts` (`'taches/:id'`)

**Interfaces:**
- Consumes: `ApiService.tache(id)`, `ApiService.action(id, nom, corps)`, `ApiService.journal(id)`, types `FicheTache`, `Analyse`, `Verdict`.
- Produces: `TacheVue` (route `taches/:id`, lit l'id par `input()` lié à la route : `withComponentInputBinding()` dans `provideRouter`), `RapportVue` (`input.required<{ analyse: string | null; verdict: string | null; rapport: string | null }>()`).

Comportement (les actions visibles dépendent de l'état, exactement comme les routes de 2a les acceptent ; l'orchestrateur reste juge, une erreur 409 s'affiche telle quelle) :

| État de la tâche | Bloc affiché |
| --- | --- |
| `cadrage` + `attente_humain` + raison `le cadreur attend ta réponse` | Dernières questions du cadreur (échanges `cadreur`), champ de réponse, bouton « Envoyer » → action `reponse` `{ texte }` |
| `cadrage` + `attente_humain` + raison `spec et plan à valider` | `spec.md · rendu`, critères numérotés `C1…`, `plan.md · rendu` depuis `proposition` ; bouton « Valider la spec et le plan » → action `validation-cadrage` `{}` |
| `patron_plan` + `attente_humain` | Note du patron (`documents.avis_patron`) ; boutons « Garder l'approche du cadreur » → `arbitrage { choix: 'cadreur' }`, « Adopter l'alternative » → `arbitrage { choix: 'alternative' }` |
| `en_pause` raison `budget` | « Budget de la tâche dépassé », « {dépense} consommés sur un plafond de {budget} », bouton « Continuer (+ 2,00 $) » → `budget { montantUsd: 2 }` |
| `en_pause` raison `integrite`, `arret_global` ou `erreur_api` ; ou `bloquee` | Raison complète ; bouton « Reprendre » → `reprise {}` |
| `en_pause` raison `escalade` | « En attente de ta décision au poste de sécurité » + lien `/securite` |
| `validation` + `attente_humain` | « Prête pour ta validation : la boîte de validation arrive en phase 3. » + documents |
| `anomalie` présent dans la fiche | Bandeau rouge « Anomalie d'intégrité : {message} » ; aucun document affiché |

Toujours affichés : en-tête `{id} · {projet}`, titre, `LIBELLE_ETAPE`, `qui()`, `essai()`, `budget()` ; onglets « Documents » (demande, spec, critères, plan, avis du patron, résumé de l'implémenteur, avis du patron sur le code — chacun seulement s'il existe, en `<pre>`), « Rapport » (`RapportVue`), « Activité » (journal de la tâche : heure `HH:MM`, commande, décision, décideur · raison ; les plus récentes en haut). La fiche et l'activité se rechargent toutes les 3 s tant que la vue est ouverte, et juste après chaque action.

Le texte vient des agents et du dépôt : il est **toujours** rendu par interpolation Angular (`{{ }}`, échappée) dans des `<pre>` — jamais `[innerHTML]`, jamais de rendu Markdown en HTML (les documents sont de la donnée).

`RapportVue` :
- « Rapport en construction » tant que `analyse` est null : « Analyse pas encore faite. »
- Avec `analyse` (JSON) : tableau des outils (`LIBELLES` : `tests_dotnet` → `dotnet test`, `audit_dotnet` → `dotnet list package --vulnerable`, `tests_angular` → `ng test`, `audit_npm` → `npm audit`, `semgrep` → `Semgrep`, `gitleaks` → `gitleaks`, `couverture` → `couverture des lignes modifiées` ; statut `ok` « ✓ », `echec` « ✕ échec », `absent` « ✕ mesure manquante », `non_applicable` « — non applicable ») ; tests `{total - echecs} / {total} verts` ; « Couverture des lignes modifiées : {p} % ({couvertes} / {total}) » ou « non mesurable » ; si `sourcesHorsCouverture` non vide, « Hors couverture : » + liste ; « Failles par sévérité » : compte par `critique`, `haute`, `moyenne`, `basse`, puis chaque constat `sévérité · message · fichier` ; « Signalements » (liste) ou « Signes de triche : aucun ».
- Avec `verdict` (JSON) : « Verdict QA : GO » (classe `go`) ou « Verdict QA : NO-GO » (classe `nogo`) ; « Règles automatiques : aucune condition de no-go déclenchée. » si `regles` est vide, sinon la liste des règles déclenchées ; critères `✓`/`✕` `C{numero} · Preuve : {preuve}`.
- Un JSON illisible affiche « Document illisible » (jamais d'exception).
- Le texte libre du reviewer (`rapport`) s'affiche sous le titre « Rapport du reviewer ».

- [ ] **Step 1: Tests qui échouent.** `rapport.spec.ts` : (a) analyse null → « Analyse pas encore faite. » ; (b) analyse avec `outils.semgrep = 'absent'` → « ✕ mesure manquante » sur la ligne Semgrep ; (c) couverture `{ couvertes: 142, total: 161, pourcentage: 88.2, sourcesHorsCouverture: ['src/A.cs'] }` → « 88.2 % (142 / 161) » et « src/A.cs » ; (d) verdict no-go avec `regles: ['couverture des lignes modifiées 70 % < 80 %']` → « Verdict QA : NO-GO » et la règle ; (e) verdict go sans règle → texte « aucune condition de no-go déclenchée » ; (f) `verdict = '{'` → « Document illisible » ; (g) un constat dont le message est `<img src=x onerror=alert(1)>` apparaît comme texte (le DOM ne contient aucun élément `img`).
  `tache.spec.ts` (doublure `ApiService`, `vi.useFakeTimers()`) : un cas par ligne du tableau d'états (le bon bouton existe, appelle la bonne action avec le bon corps, puis recharge la fiche) ; une erreur 409 de l'action s'affiche ; une fiche avec `anomalie` affiche le bandeau et aucun document ; la spec contenant `<script>` est rendue en texte.

Run: `npm run test:web` — Expected: FAIL.

- [ ] **Step 2: Implémentation** de `TacheVue` et `RapportVue` selon le tableau et les règles ci-dessus (gabarits en ligne, signaux, `setInterval` de 3 s démarré dans le constructeur via `effect`/`ngOnInit` et arrêté dans `ngOnDestroy`). Analyse du JSON :

```ts
function lire<T>(texte: string | null): T | null | 'illisible' {
  if (texte === null) return null;
  try { return JSON.parse(texte) as T; } catch { return 'illisible'; }
}
```

Ajouter `withComponentInputBinding()` à `provideRouter(routes, …)` dans `app.config.ts`, et la route `{ path: 'taches/:id', component: TacheVue }`.

- [ ] **Step 3: Vérifier.** `npm run test:web` (PASS), `npm run web:build`.

- [ ] **Step 4: Commit** — `git add web && git commit -m "Panneau : fiche de tâche, échanges avec le cadreur, arbitrage, reprise, rapport et verdict"`

---

### Task 7: Poste de sécurité — escalades et journal des commandes

**Files:**
- Create: `web/src/app/securite/securite.ts`, `web/src/app/securite/journal.ts` et leurs `.spec.ts`
- Modify: `web/src/app/app.routes.ts` (`'securite'`, `'journal'`, `'**'`)

**Interfaces:**
- Consumes: `EtatBureau.escalades`, `ApiService.deciderEscalade`, `ApiService.journal()`, `ApiService.integrite()`.
- Produces: `Securite` (route `securite`), `Journal` (route `journal`).

`Securite` — titre « Poste de sécurité · Commande escaladée ». Sans escalade : « Aucune commande en attente. » Pour chaque escalade : `{tacheId}`, « Tâche en pause depuis {HH:MM} » (d'après `creeLe`), la commande en bloc `$ …` (pour `Bash`, `entree` est un JSON `{ command }` : afficher `command` ; sinon afficher `outil` puis `entree` brute), « Raison donnée par le gardien » + `raison`, un champ « Commentaire (facultatif) », boutons « Autoriser » → `deciderEscalade(id, 'approuver', commentaire)` et « Refuser » → `deciderEscalade(id, 'refuser', commentaire)`, puis `EtatBureau.rafraichir()`. Après « Autoriser », rappeler que la tâche reste en pause et se reprend depuis son panneau seulement si c'est ce que fait `deciderEscalade` côté orchestrateur (vérifier dans `src/gardien/service.ts` → `deciderEscalade` ; afficher le statut de la tâche renvoyé). Les deux boutons sont désactivés pendant l'appel (pas de double décision).

`Journal` — titre « Poste de sécurité · Journal des commandes » ; en tête, `GET /api/journal/integrite` : « ✓ Chaîne intacte sur {n} entrées » (classe `go`) ou « ✕ Chaîne rompue : {erreur} » (classe `nogo`) ; filtres « Tâche » (toutes ou une tâche présente dans le journal) et « Décision » (toutes, `Autorisé`, `Refusé`, `Escaladé`) ; tableau `Heure | Tâche | Commande | Couche | Décision | Décideur | Raison`, plus récentes en haut, 500 lignes au plus affichées (« 500 plus récentes sur {n} » si tronqué). Rechargement toutes les 3 s. Tout en interpolation (texte).

- [ ] **Step 1: Tests qui échouent.** `securite.spec.ts` : escalade Bash `{"command":"npm install csv-parsr@0.1.2"}` affiche `$ npm install csv-parsr@0.1.2` et la raison ; « Autoriser » avec commentaire `ok` appelle `deciderEscalade(1, 'approuver', 'ok')` une seule fois même après deux clics rapides ; « Refuser » appelle `'refuser'` ; une erreur de l'API s'affiche ; `entree` non JSON s'affiche brute. `journal.spec.ts` : chaîne intacte / rompue ; filtre Tâche et filtre Décision réduisent les lignes ; ordre décroissant par `id` ; 600 entrées → 500 lignes et « 500 plus récentes sur 600 ».

Run: `npm run test:web` — Expected: FAIL.

- [ ] **Step 2: Implémentation** selon la description (gabarits en ligne ; `computed` pour les filtres ; `setInterval` 3 s arrêté dans `ngOnDestroy`). Routes : `{ path: 'securite', component: Securite }`, `{ path: 'journal', component: Journal }`, `{ path: '**', redirectTo: '' }`.

- [ ] **Step 3: Vérifier.** `npm run test:web` (PASS), `npm run web:build`.

- [ ] **Step 4: Commit** — `git add web && git commit -m "Panneau : poste de sécurité (escalades) et journal des commandes avec intégrité"`

---

### Task 8: Documentation et vérification de bout en bout

**Files:**
- Modify: `CLAUDE.md` (section Commandes), `README.md`

- [ ] **Step 1: Documentation.** `CLAUDE.md`, section Commandes, ajouter :
  - « Panneau web : `npm --prefix web ci` (première fois), `npm run web:build` (à relancer après toute modification de `web/`), tests `npm run test:web`. Le front Angular 21 a son propre `package.json` (TypeScript 5.9) ; la racine reste en TypeScript 6. »
  - Remplacer la ligne Lancement par : « Lancement : `ANTHROPIC_API_KEY=… npm run demarrer`, puis ouvrir le lien affiché (`http://127.0.0.1:4310/#jeton=…`) ; serveurs sur 127.0.0.1:4310 et 127.0.0.1:4311. »
  `README.md` : même procédure de lancement, en trois lignes.

- [ ] **Step 2: Vérification complète.** `npm test`, `npm run typecheck`, `npm run test:web`, `npm run web:build`. Puis démarrage réel sans clé API (les écrans ne lancent aucun agent tant qu'aucune story n'est créée) : `BUREAU_DONNEES=$(mktemp -d) DOCKER_HOST=unix:///var/run/docker.sock npm run demarrer` en arrière-plan, puis :
  - `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4310/` → `200`, en-tête `content-security-policy` présent (`curl -sI`) ;
  - `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4310/api/taches` → `401` ;
  - `curl -s -H "Authorization: Bearer <jeton du lien>" http://127.0.0.1:4310/api/etat` → `{"ordonnanceur":"actif"}`.
  Si un navigateur piloté est disponible (skill `run` / Chrome), ouvrir le lien, vérifier que le fragment disparaît de la barre d'adresse, que le hall vide s'affiche, et relier `test/fixtures/projet-dotnet` (s'il est un dépôt Git ; sinon une copie `git init` dans un dossier temporaire) : la détection affiche `✓ .NET`. Arrêter le processus et supprimer le dossier de données temporaire.

- [ ] **Step 3: Commit** — `git commit -am "Documentation : construction et lancement du panneau web"`

---

## Annexe A — Textes de la maquette repris

Hall : « Hall d'entrée · Tableau des tâches », « + Relier un projet », « + Nouvelle user story », colonnes « Cadrage », « Patron (plan) », « Implémentation », « Review », « Patron (code) », « QA », « Validation » ; carte : projet, id, titre, qui, « essai n/3 », « x,xx $ / y,yy $ » ; qui : « Cadreur · t’attend », « Toi · à valider », « Implémenteur · en pause », « Implémenteur · budget dépassé », « Bloquée · … », « En file ».
Bureau vide : « Le bureau est vide », « Aucun projet relié, aucun agent au travail. Relie un premier dossier local (.NET ou Angular) : le bureau détecte la stack, propose les seuils par défaut, et le cadreur pourra prendre ta première user story. », « + Relier un premier projet ».
Relier un projet : « Relier un projet », « 1 · Dossier local », « 2 · Détection », « ✓ .NET », « ✓ Angular », « Image de base utilisée (SDK .NET, Node, Chrome headless, outils d'analyse) », « 3 · Réglages du projet », « Seuil de couverture (lignes modifiées) », « Budget par tâche », « Au-delà du budget, la tâche s'arrête et demande ton accord. Au-delà de la durée, elle passe en « bloquée ». », « Annuler », « Relier le projet ».
Nouvelle user story : « Nouvelle user story », « Projet », « Titre », « Description libre », « Le cadreur part d'un contexte vierge : il lit le repo, ta demande et la maquette éventuelle, puis te propose spec.md et plan.md. », « Annuler », « Envoyer au cadreur ».
Panneau : « spec.md · rendu », « plan.md · rendu », « Envoyer », « Garder l'approche du cadreur », « Adopter l'alternative », « Budget de la tâche dépassé », « consommés sur un plafond de », « Continuer (+ 2,00 $) ».
Rapport et verdict : « Rapport en construction », « Couverture du code modifié », « Failles par sévérité », « Signes de triche : aucun », « Verdict QA : GO », « Règles automatiques : aucune condition de no-go déclenchée. », « Preuve : ».
Poste de sécurité : « Poste de sécurité · Commande escaladée », « Tâche en pause depuis », « Raison donnée par le gardien », « Autoriser », « Refuser », « Poste de sécurité · Journal des commandes », « ✓ Chaîne intacte sur N entrées », colonnes « Heure Tâche Commande Couche Décision Décideur Raison », filtres « Tâche », « Décision ».
Arrêt global : « Arrêt global ? », « Annuler », « Tout arrêter », « Tout reprendre ? », « Reprendre ».

## Reporté

- Phase 3 : boîte de validation (diff, rapports, avis du patron, journal ; branche, PR, renvoi avec commentaire, abandon), alerte d'intégrité avec diff et restauration, « Tâche bloquée » avec résumé et historique des essais, écran Réglages (modèles, seuils par défaut).
- Phase 4 : carte Phaser, mini-carte, avatars, notifications.
