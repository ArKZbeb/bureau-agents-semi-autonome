# Phase 2b — Outils d'analyse et règles QA automatiques : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** À l'étape Review, l'orchestrateur lance lui-même les outils d'analyse sur la copie de contrôle : tests avec couverture, audits de dépendances, Semgrep et gitleaks. Il en tire un rapport d'analyse signé, et le verdict QA applique les règles automatiques de la spec : test en échec, faille critique ou haute, couverture des lignes modifiées sous le seuil, critère non rempli, outil qui n'a pas tourné.

**Architecture:** Un script d'analyse figé dans l'image (`/opt/analyse/analyser.sh`, couvert par le manifeste signé) tourne dans un conteneur durci, sur la copie de contrôle. Le réseau passe par la passerelle, pour la restauration NuGet / npm seulement, et aucun Claude Code ne s'exécute dans ce conteneur. Le script écrit ses résultats bruts dans `/workspace/analyse/` de la copie. L'orchestrateur les relit avec des lecteurs purs (diff, Cobertura, TRX, audits, Semgrep, gitleaks), calcule la couverture des lignes modifiées depuis le commit de base enregistré à la création de la tâche, et signe l'artefact `analyse`. Le moteur de règles QA combine cette analyse, le seuil du projet (stocké par l'orchestrateur, jamais dans le dépôt) et la sortie de l'agent QA.

**Tech Stack:** inchangée côté orchestrateur (aucune dépendance npm nouvelle). Image : SDK .NET, Chromium, Semgrep, gitleaks, `dotnet-coverage`, dans des versions exactes fixées par la Task 1.

**Spec:** `docs/superpowers/specs/2026-10-28-bureau-agents-design.md` (« Les agents » : reviewer et règles QA ; « Guardrails IA » : triche sur l'évaluation ; « Erreurs » : « Outil d'analyse en échec → mesure manquante = no-go »). Plans précédents : `docs/superpowers/plans/2026-10-29-phase-1-orchestrateur-gardien.md`, `docs/superpowers/plans/2026-10-29-phase-2a-agents-pipeline.md` ; leurs Global Constraints restent valables. Maquette : `maquette/bureau-des-agents.html` (salle de review, labo QA : « couverture des lignes modifiées 72 % < 80 % »).

## Choix de conception à valider avec ce plan

1. **C'est l'orchestrateur, pas l'agent reviewer, qui lance les outils.** Les mesures sont produites hors de portée des agents, puis signées. Le reviewer et le QA reçoivent le rapport signé et peuvent relancer les tests eux-mêmes, mais leurs affirmations ne remplacent jamais une mesure.
2. **Les seuils sont gardés par l'orchestrateur** (table `seuils_projets`, 80 % par défaut), jamais lus dans le dépôt. C'est plus fort qu'un montage en lecture seule : l'implémenteur ne peut ni les lire ni les modifier. La configuration de couverture du dépôt n'est pas utilisée : l'image apporte sa propre configuration Karma et `dotnet-coverage`.
3. **Couverture bloquante sur les lignes modifiées** (ajoutées ou changées) qui sont instrumentées. S'il n'y en a aucune, le pourcentage est « non mesurable » et ne bloque pas. La couverture des branches n'est pas calculée en 2b.
4. **Périmètre des outils :**
   - .NET : `dotnet test` sous `dotnet-coverage` (Cobertura et TRX), puis `dotnet list package --vulnerable --include-transitive`.
   - Angular : `ng test` avec Karma et ChromeHeadless, couverture Cobertura via la configuration de l'image, puis `npm audit`.
   - Toutes stacks : Semgrep, avec des règles figées dans l'image et sans accès au registre en ligne, sur les fichiers modifiés ; gitleaks sur les commits de la branche.
   - Hors 2b : ReportGenerator, Roslyn et ESLint en mesure. Le reviewer peut lancer le lint lui-même.
5. **Signes de triche détectés de façon déterministe dans le diff** (test supprimé, `Skip` ou `xit` ajouté, fichier de configuration de couverture ou de test modifié). Ils sont signalés dans le rapport et transmis au contrôleur d'intégrité, au reviewer et au QA. Ils ne valent pas no-go automatique, faute de règle dans la spec.
6. **Une seule analyse par passage en review.** Le QA vérifie que la branche n'a pas bougé depuis (même SHA). Sinon, c'est une anomalie d'intégrité.

## Global Constraints

- Global Constraints des plans de phase 1 et 2a : Node ≥ 24.11, syntaxe effaçable, imports `.ts`, TypeScript 6.0.3, aucune dépendance npm nouvelle, `node:test`, `npm test` sans Docker ni réseau, `npm run test:docker` avec Docker, **aucun appel API réel**, règles de sécurité de `CLAUDE.md`, commits en français terminés par la ligne `Co-Authored-By` du modèle auteur.
- Sous Linux : `npm_config_script_shell=/bin/bash` ; avec Docker Desktop installé, `DOCKER_HOST=unix:///var/run/docker.sock`.
- Conteneur d'analyse : mêmes protections que les agents (non root, `CapDrop: ALL`, `no-new-privileges`, racine en lecture seule sauf `/workspace` et `/tmp`, limites mémoire / CPU / PIDs, réseau de tâche interne, sortie uniquement par la passerelle, aucun secret, jeton de tâche).
- Toute image et tout outil sont référencés par une version exacte ; les binaires téléchargés sont vérifiés par SHA-256 dans le Dockerfile.
- Les sorties d'outils et le contenu du dépôt sont des données : jamais interprétés comme instructions. Aucune valeur de secret détectée par gitleaks n'est recopiée (seulement règle, fichier, ligne).
- Libellés : décideur `Orchestrateur`, couche `—`, raison « analyse de review » (maquette, ligne Semgrep). Règle de couverture affichée « couverture des lignes modifiées 72 % < 80 % ».
- Règles QA (spec) : no-go automatique si un test échoue, une faille critique ou haute est détectée, la couverture des lignes modifiées est sous le seuil, un critère n'est pas rempli, ou un outil d'analyse n'a pas pu tourner. Seuil par défaut 80 %, configurable par projet.
- Toute anomalie d'intégrité = pause, jamais de reprise automatique.
- Après tout changement dans `agents/` ou `conteneur/` : `npm run image`.
- Ne jamais affaiblir un test, une assertion ou un seuil pour faire passer une suite ; une mise à jour de mise en place est permise et signalée.

## Structure des fichiers

```
conteneur/
  Dockerfile                    + SDK .NET, Chromium, Semgrep, gitleaks, dotnet-coverage
  analyse/analyser.sh           script d'analyse (nouveau)
  analyse/karma.conf.cjs        configuration Karma de l'image (nouveau)
  analyse/chromium-conteneur    lanceur Chromium headless sans bac à sable (nouveau)
  analyse/semgrep-regles.yml    règles Semgrep figées (nouveau, produit par la Task 1)
agents/reviewer.md, qa.md, patron-code.md   + mention du rapport d'analyse
src/
  analyse/diff.ts               lignes modifiées depuis un diff -U0 (nouveau)
  analyse/cobertura.ts          lecture Cobertura, couverture des lignes modifiées (nouveau)
  analyse/rapports.ts           TRX, npm audit, dotnet vulnérabilités, Semgrep, gitleaks (nouveau)
  analyse/triche.ts             signes de triche dans le diff (nouveau)
  analyse/analyse.ts            type Analyse, assemblage depuis les fichiers bruts (nouveau)
  analyse/regles.ts             moteur de règles QA (nouveau)
  analyse/execution.ts          lancement du conteneur d'analyse (nouveau)
  taches/seuils.ts              seuils par projet (nouveau)
  conteneurs/docker.ts          + lireShaVolume
  conteneurs/execution.ts       + envTache (extrait de lancerEtape)
  db.ts                         + seuils_projets ; colonne taches.commit_base
  taches/depot.ts               + commitBase
  integrite/artefacts.ts        + type 'analyse'
  config.ts                     + seuilCouvertureLignes, delaiAnalyseMs
  pipeline/prompts.ts           + documents « analyse »
  pipeline/pipeline.ts          + analyse en review, contrôle du SHA et règles en QA
  orchestrateur.ts              + commit de base à la création, câblage
test/fixtures/analyse/          sorties réelles des outils (produites par la Task 1)
test/fixtures/projet-dotnet/    petit projet .NET avec tests xUnit (nouveau)
test/analyse/*.test.ts          un fichier par module
test-docker/analyse.test.ts     analyse réelle du projet .NET d'exemple (nouveau)
```

---

### Task 1: Spike — outils dans l'image, versions et formats réels

Objectif : fixer les versions exactes, vérifier que chaque outil tourne dans le conteneur durci (non root, racine en lecture seule, réseau par la passerelle), et produire des **sorties réelles** qui servent de jeux d'essai aux lecteurs.

**Files:**
- Create: `docs/superpowers/spikes/2026-10-30-outils-analyse.md`
- Create: `test/fixtures/analyse/` (sorties réelles : `dotnet.trx`, `dotnet.cobertura.xml`, `dotnet-vulnerables.json`, `npm-audit.json`, `semgrep.json`, `gitleaks.json`, `angular.cobertura.xml`, `diff.patch`)
- Create: `conteneur/analyse/semgrep-regles.yml`

- [ ] **Step 1: Choisir et noter les versions**

Relever les dernières versions stables à cette date, chacune avec son URL et son SHA-256 si c'est un binaire :
- SDK .NET 9 et runtime ASP.NET Core 8 (projets .NET 8 et 9 de la maquette) ;
- Chromium Debian (paquet de la distribution de l'image `node:24-slim`) ;
- Semgrep (pip, dans un venv) ;
- gitleaks (archive linux x64 du dépôt officiel) ;
- outil global `dotnet-coverage`.

- [ ] **Step 2: Image d'essai**

Écrire un Dockerfile d'essai dans le scratchpad, à partir de `conteneur/Dockerfile`, qui installe ces outils. Vérifier, en tant qu'utilisateur `node` et avec `--read-only --tmpfs /tmp`, avec `HOME`, `DOTNET_CLI_HOME`, `NUGET_PACKAGES` et `npm_config_cache` placés sous `/workspace/.analyse-home` :
- `dotnet --list-sdks` et `--list-runtimes` ;
- `semgrep --version`, `gitleaks version` et `chromium --version` ;
- `dotnet-coverage --version`.

- [ ] **Step 3: Règles Semgrep hors ligne**

Récupérer à la construction un jeu de règles (par exemple `https://semgrep.dev/c/p/default`, ou `p/csharp` et `p/typescript`) et l'enregistrer dans `conteneur/analyse/semgrep-regles.yml`. Vérifier que `semgrep scan --config conteneur/analyse/semgrep-regles.yml --json --metrics=off --disable-version-check` tourne **sans réseau** (`--network none`).

- [ ] **Step 4: Sorties réelles**

Créer un petit projet .NET (bibliothèque et projet xUnit, avec un test qui échoue et un test qui passe), un dépôt git avec un commit de base puis un commit qui modifie une méthode et ajoute un faux secret (`AWS_SECRET_ACCESS_KEY=AKIA…` factice), et si possible un petit projet Angular généré (`ng new --minimal`). Lancer :
- `dotnet-coverage collect -f cobertura -o dotnet.cobertura.xml "dotnet test --logger trx;LogFileName=dotnet.trx"` ;
- `dotnet list package --vulnerable --include-transitive --format json` ;
- `npm audit --json` ;
- `semgrep` (commande du Step 3) ;
- `gitleaks git --log-opts="<base>..HEAD" --report-format json --report-path gitleaks.json --exit-code 0`, ou la sous-commande équivalente selon la version ;
- `git diff -U0 <base>..HEAD` ;
- pour Angular : `ng test --watch=false --code-coverage --karma-config` vers une configuration qui ajoute le reporter Cobertura et un lanceur ChromeHeadless sans bac à sable.

Copier les sorties dans `test/fixtures/analyse/`, **après avoir retiré toute valeur de secret** du JSON gitleaks (remplacer `Secret` et `Match` par `"<retiré>"`).

- [ ] **Step 5: Consigner**

Dans le document de spike, noter : versions et SHA-256, commandes exactes qui marchent, chemins de sortie, codes de retour (tests en échec, aucun résultat), forme exacte des champs utiles de chaque format (TRX `Counters`, Cobertura `class@filename` / `line@number,hits` / `sources`, npm audit `vulnerabilities.*.severity`, dotnet `projects[].frameworks[].topLevelPackages[].vulnerabilities[].severity` et `transitivePackages`, Semgrep `results[].extra.severity`, gitleaks `RuleID` / `File` / `StartLine`), et tout écart avec les Tasks 2 à 9 (noms de champs, sous-commande gitleaks, options Karma).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/spikes/2026-10-30-outils-analyse.md test/fixtures/analyse conteneur/analyse/semgrep-regles.yml
git commit -m "Spike : outils d'analyse dans l'image, versions, sorties réelles"
```

---

### Task 2: Image d'analyse et script

**Files:**
- Modify: `conteneur/Dockerfile`
- Create: `conteneur/analyse/analyser.sh`, `conteneur/analyse/karma.conf.cjs`, `conteneur/analyse/chromium-conteneur`
- Test: `test-docker/conteneurs.test.ts`

**Interfaces:**
- Produces : dans l'image, `/opt/analyse/analyser.sh <commit_base>`. Lancé dans `/workspace/projet` d'une copie, il écrit dans `/workspace/analyse/` :
  - `sha` (HEAD) et `diff.patch` (`git diff -U0 <base>..HEAD`) ;
  - `fichiers-modifies` (un chemin par ligne, fichiers existants seulement) ;
  - par outil `<outil>.code` (code de retour) ou `<outil>.na` (non applicable) ;
  - sorties : `dotnet.trx`, `dotnet.cobertura.xml`, `dotnet-vulnerables.json`, `angular.cobertura.xml`, `npm-audit.json`, `semgrep.json`, `gitleaks.json`.
  - Outils : `tests_dotnet`, `audit_dotnet`, `tests_angular`, `audit_npm`, `semgrep`, `gitleaks`.

- [ ] **Step 1: Test qui échoue (Docker)**

Dans `test-docker/conteneurs.test.ts` :

```ts
test('image d’analyse : outils présents et script installé', async () => {
  const sortie = await executerDansImage(image, 'dotnet --list-sdks && semgrep --version && gitleaks version && chromium --version && test -x /opt/analyse/analyser.sh && test -f /opt/analyse/semgrep-regles.yml && echo OUTILS-OK');
  assert.match(sortie, /OUTILS-OK/);
});
```

avec une aide `executerDansImage(image, script)` qui crée un conteneur `User: 'node'`, `ReadonlyRootfs: true`, `Tmpfs: { '/tmp': 'rw' }`, `NetworkMode: 'none'`, `Cmd: ['bash', '-c', script]`, attend sa fin et renvoie stdout et stderr (démultiplexés avec `demultiplexer` de `src/conteneurs/docker.ts`), puis le supprime.

- [ ] **Step 2: Vérifier l'échec**

Run : `DOCKER_HOST=unix:///var/run/docker.sock npm run image && node --disable-warning=ExperimentalWarning --test --test-timeout=900000 --test-name-pattern "image d’analyse" test-docker/conteneurs.test.ts`
Expected : FAIL (`dotnet: not found`).

- [ ] **Step 3: Dockerfile**

Avant `COPY managed-settings.json`, ajouter en reprenant **exactement** les versions et les SHA-256 de la Task 1 :

```dockerfile
# Outils d'analyse lancés par l'orchestrateur (jamais par un agent) : versions exactes, binaires vérifiés.
RUN apt-get update && apt-get install -y --no-install-recommends chromium python3-venv curl libicu-dev && rm -rf /var/lib/apt/lists/*
ARG DOTNET_SDK_VERSION=<version Task 1>
ARG ASPNET8_VERSION=<version Task 1>
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
 && echo "<sha256 du script Task 1>  /tmp/dotnet-install.sh" | sha256sum -c - \
 && bash /tmp/dotnet-install.sh --version "$DOTNET_SDK_VERSION" --install-dir /usr/share/dotnet \
 && bash /tmp/dotnet-install.sh --runtime aspnetcore --version "$ASPNET8_VERSION" --install-dir /usr/share/dotnet \
 && ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet && rm /tmp/dotnet-install.sh
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
RUN dotnet tool install --tool-path /opt/dotnet-outils dotnet-coverage --version <version Task 1> \
 && ln -s /opt/dotnet-outils/dotnet-coverage /usr/local/bin/dotnet-coverage
RUN python3 -m venv /opt/semgrep && /opt/semgrep/bin/pip install --no-cache-dir semgrep==<version Task 1> \
 && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep
RUN curl -fsSL -o /tmp/gitleaks.tar.gz <url Task 1> \
 && echo "<sha256 Task 1>  /tmp/gitleaks.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks && rm /tmp/gitleaks.tar.gz
COPY analyse/ /opt/analyse/
RUN chmod 0555 /opt/analyse/analyser.sh /opt/analyse/chromium-conteneur && chmod 0444 /opt/analyse/karma.conf.cjs /opt/analyse/semgrep-regles.yml
```

Les `<…>` sont les valeurs relevées par la Task 1 et consignées dans son document. Aucun `<…>` ne doit rester dans le fichier commité.

- [ ] **Step 4: Fichiers d'analyse**

`conteneur/analyse/chromium-conteneur` :

```bash
#!/bin/sh
# Chromium sans bac à sable : le conteneur (non root, cap-drop ALL, no-new-privileges) est l'isolation.
exec /usr/bin/chromium --no-sandbox --disable-gpu --disable-dev-shm-usage "$@"
```

`conteneur/analyse/karma.conf.cjs` :

```js
// Configuration Karma de l'image : celle du projet est chargée, puis la couverture et le navigateur sont imposés.
const path = require('node:path');
module.exports = function (config) {
  const projet = path.join(process.cwd(), 'karma.conf.js');
  try { require(projet)(config); } catch { /* projet sans karma.conf.js : réglages par défaut d'Angular */ }
  config.set({
    browsers: ['ChromeHeadlessConteneur'],
    customLaunchers: { ChromeHeadlessConteneur: { base: 'ChromeHeadless', flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] } },
    singleRun: true,
    autoWatch: false,
    coverageReporter: { dir: '/workspace/analyse/angular-couverture', subdir: '.', reporters: [{ type: 'cobertura', file: 'cobertura.xml' }] },
  });
};
```

`conteneur/analyse/analyser.sh` :

```bash
#!/bin/bash
# Analyse de la copie de contrôle, lancée par l'orchestrateur. Usage : analyser.sh <commit_base>
# Chaque outil écrit <outil>.code (code de retour) ou <outil>.na (non applicable) dans /workspace/analyse.
set -u
BASE="$1"
SORTIE=/workspace/analyse
PROJET=/workspace/projet
export HOME=/workspace/.analyse-home DOTNET_CLI_HOME=/workspace/.analyse-home NUGET_PACKAGES=/workspace/.analyse-home/nuget
export npm_config_cache=/workspace/.analyse-home/npm npm_config_ignore_scripts=true CHROME_BIN=/opt/analyse/chromium-conteneur
export SEMGREP_ENABLE_VERSION_CHECK=0 SEMGREP_SEND_METRICS=off
rm -rf "$SORTIE" && mkdir -p "$SORTIE" "$HOME"
cd "$PROJET" || exit 3
git config --global --add safe.directory '*'
case "$BASE" in *[!0-9a-f]*|'') echo "commit de base invalide" >&2; exit 3;; esac

git rev-parse HEAD > "$SORTIE/sha"
git diff -U0 "$BASE..HEAD" > "$SORTIE/diff.patch"
git diff --name-only --diff-filter=d "$BASE..HEAD" > "$SORTIE/fichiers-modifies"

code() { echo "$2" > "$SORTIE/$1.code"; }
na() { : > "$SORTIE/$1.na"; }

# .NET : solution (ou projet) la plus proche de la racine.
CIBLE_DOTNET=$(find . -path ./node_modules -prune -o \( -name '*.sln' -o -name '*.slnx' \) -print | sort | head -n 1)
[ -z "$CIBLE_DOTNET" ] && CIBLE_DOTNET=$(find . -path ./node_modules -prune -o -name '*.csproj' -print | sort | head -n 1)
if [ -n "$CIBLE_DOTNET" ]; then
  timeout 1800 dotnet restore "$CIBLE_DOTNET" > "$SORTIE/dotnet-restore.log" 2>&1
  timeout 1800 dotnet-coverage collect -f cobertura -o "$SORTIE/dotnet.cobertura.xml" \
    "dotnet test $CIBLE_DOTNET --no-restore --logger trx;LogFileName=$SORTIE/dotnet.trx" > "$SORTIE/dotnet-test.log" 2>&1
  code tests_dotnet $?
  timeout 600 dotnet list "$CIBLE_DOTNET" package --vulnerable --include-transitive --format json > "$SORTIE/dotnet-vulnerables.json" 2> "$SORTIE/dotnet-vulnerables.log"
  code audit_dotnet $?
else
  na tests_dotnet; na audit_dotnet
fi

# Angular : premier angular.json hors node_modules.
ANGULAR=$(find . -path ./node_modules -prune -o -name angular.json -print | sort | head -n 1)
if [ -n "$ANGULAR" ]; then
  DOSSIER=$(dirname "$ANGULAR")
  ( cd "$DOSSIER" && timeout 1800 npm ci --ignore-scripts > "$SORTIE/npm-ci.log" 2>&1 \
    && timeout 1800 npx --no-install ng test --watch=false --code-coverage --karma-config /opt/analyse/karma.conf.cjs > "$SORTIE/angular-test.log" 2>&1 )
  code tests_angular $?
  [ -f "$SORTIE/angular-couverture/cobertura.xml" ] && cp "$SORTIE/angular-couverture/cobertura.xml" "$SORTIE/angular.cobertura.xml"
  ( cd "$DOSSIER" && timeout 600 npm audit --json > "$SORTIE/npm-audit.json" 2> "$SORTIE/npm-audit.log" )
  # npm audit renvoie 1 quand il trouve des vulnérabilités : seul un JSON absent ou vide est une mesure manquante.
  [ -s "$SORTIE/npm-audit.json" ] && code audit_npm 0 || code audit_npm 1
else
  na tests_angular; na audit_npm
fi

# Semgrep sur les fichiers modifiés existants, règles figées, sans réseau ni télémétrie.
if [ -s "$SORTIE/fichiers-modifies" ]; then
  timeout 900 semgrep scan --config /opt/analyse/semgrep-regles.yml --json --metrics=off --disable-version-check \
    --output "$SORTIE/semgrep.json" $(cat "$SORTIE/fichiers-modifies") > "$SORTIE/semgrep.log" 2>&1
  code semgrep $?
else
  echo '{"results":[]}' > "$SORTIE/semgrep.json"; code semgrep 0
fi

# gitleaks sur les commits de la branche uniquement.
timeout 600 gitleaks git --log-opts="$BASE..HEAD" --report-format json --report-path "$SORTIE/gitleaks.json" --exit-code 0 > "$SORTIE/gitleaks.log" 2>&1
code gitleaks $?
exit 0
```

Adapter les sous-commandes et options aux écarts consignés par la Task 1 (par exemple `gitleaks detect` selon la version, ou le code de retour de Semgrep quand il trouve des résultats). Signaler chaque adaptation dans le rapport.

- [ ] **Step 5: Vérifier le succès**

Run : `DOCKER_HOST=unix:///var/run/docker.sock npm run image && node --disable-warning=ExperimentalWarning --test --test-timeout=900000 test-docker/conteneurs.test.ts`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add conteneur test-docker/conteneurs.test.ts
git commit -m "Image : outils d'analyse et script lancé par l'orchestrateur"
```

---

### Task 3: Lignes modifiées et couverture Cobertura

**Files:**
- Create: `src/analyse/diff.ts`, `src/analyse/cobertura.ts`
- Test: `test/analyse/diff.test.ts`, `test/analyse/cobertura.test.ts`

**Interfaces:**
- Produces :
  - `lignesModifiees(patch: string): Map<string, Set<number>>` : par chemin relatif au dépôt (`+++ b/…`), numéros des lignes ajoutées ou modifiées dans la nouvelle version (`@@ -a,b +c,d @@` → `c … c+d-1`, `d` absent = 1, `d = 0` = aucune ligne) ; fichiers supprimés (`+++ /dev/null`) ignorés.
  - `lireCobertura(xml: string): Map<string, Map<number, number>>` : par chemin relatif, numéro de ligne → nombre de passages. Chemins : préfixe `<source>` retiré, puis préfixe `/workspace/projet/` retiré, puis `./` retiré ; séparateurs `\` → `/`. Une même ligne vue plusieurs fois garde le maximum.
  - `type Couverture = { couvertes: number; total: number; pourcentage: number | null }`
  - `couvertureLignesModifiees(modifiees: Map<string, Set<number>>, couvertures: Map<string, Map<number, number>>[]): Couverture` : seules comptent les lignes modifiées présentes dans au moins une couverture (lignes instrumentées) ; une ligne est couverte si `hits > 0` dans au moins une ; `pourcentage = Math.round(couvertes / total * 100)` ou `null` si `total = 0`.

- [ ] **Step 1: Tests qui échouent**

`test/analyse/diff.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lignesModifiees } from '../../src/analyse/diff.ts';

const PATCH = `diff --git a/src/Film.cs b/src/Film.cs
index 1..2 100644
--- a/src/Film.cs
+++ b/src/Film.cs
@@ -10,0 +11,2 @@ public class Film
+  public string Titre { get; set; }
+  public string Synopsis { get; set; }
@@ -20 +22 @@ public class Film
-  return x;
+  return y;
@@ -30,2 +32,0 @@
-  a
-  b
diff --git a/vieux.txt b/vieux.txt
deleted file mode 100644
--- a/vieux.txt
+++ /dev/null
@@ -1 +0,0 @@
-x
`;

test('lignes ajoutées et modifiées par fichier, suppressions ignorées', () => {
  const m = lignesModifiees(PATCH);
  assert.deepEqual([...m.keys()], ['src/Film.cs']);
  assert.deepEqual([...m.get('src/Film.cs')!].sort((a, b) => a - b), [11, 12, 22]);
});

test('diff vide', () => assert.equal(lignesModifiees('').size, 0));
```

`test/analyse/cobertura.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { couvertureLignesModifiees, lireCobertura } from '../../src/analyse/cobertura.ts';

const XML = `<?xml version="1.0"?>
<coverage line-rate="0.5"><sources><source>/workspace/projet/</source></sources>
<packages><package name="Film"><classes>
<class name="Film" filename="src/Film.cs"><lines>
<line number="11" hits="3"/><line number="12" hits="0"/><line number="22" hits="1"/>
</lines><methods><method name="M"><lines><line number="11" hits="3"/></lines></method></methods></class>
</classes></package></packages></coverage>`;

test('Cobertura : chemins relatifs, passages par ligne', () => {
  const c = lireCobertura(XML);
  assert.deepEqual([...c.keys()], ['src/Film.cs']);
  assert.deepEqual([...c.get('src/Film.cs')!.entries()].sort((a, b) => a[0] - b[0]), [[11, 3], [12, 0], [22, 1]]);
});

test('Cobertura : chemin absolu sans <source> ramené au dépôt', () => {
  const c = lireCobertura('<coverage><class filename="/workspace/projet/src/A.ts"><line number="1" hits="1"/></class></coverage>');
  assert.deepEqual([...c.keys()], ['src/A.ts']);
});

test('couverture des lignes modifiées : seules les lignes instrumentées comptent', () => {
  const modifiees = new Map([['src/Film.cs', new Set([11, 12, 22, 99])], ['README.md', new Set([1])]]);
  assert.deepEqual(couvertureLignesModifiees(modifiees, [lireCobertura(XML)]), { couvertes: 2, total: 3, pourcentage: 67 });
});

test('aucune ligne modifiée instrumentée : non mesurable', () => {
  assert.deepEqual(couvertureLignesModifiees(new Map([['README.md', new Set([1])]]), [lireCobertura(XML)]), { couvertes: 0, total: 0, pourcentage: null });
});

test('sorties réelles du spike lisibles', () => {
  for (const f of ['dotnet.cobertura.xml', 'angular.cobertura.xml']) {
    const chemin = `test/fixtures/analyse/${f}`;
    if (fs.existsSync(chemin)) assert.ok(lireCobertura(fs.readFileSync(chemin, 'utf8')).size > 0, f);
  }
});
```

- [ ] **Step 2: Vérifier l'échec**

Run : `node --disable-warning=ExperimentalWarning --test test/analyse/diff.test.ts test/analyse/cobertura.test.ts`
Expected : FAIL (modules absents).

- [ ] **Step 3: Implémenter**

`src/analyse/diff.ts` :

```ts
// Lignes ajoutées ou modifiées dans la nouvelle version, d'après un `git diff -U0`.
export function lignesModifiees(patch: string): Map<string, Set<number>> {
  const resultat = new Map<string, Set<number>>();
  let courant: Set<number> | null = null;
  for (const ligne of patch.split('\n')) {
    if (ligne.startsWith('+++ ')) {
      const cible = ligne.slice(4).trim();
      courant = cible === '/dev/null' ? null : (resultat.get(cible.replace(/^b\//, '')) ?? new Set());
      if (courant) resultat.set(cible.replace(/^b\//, ''), courant);
      continue;
    }
    const entete = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(ligne);
    if (entete && courant) {
      const debut = Number(entete[1]);
      const nombre = entete[2] === undefined ? 1 : Number(entete[2]);
      for (let i = 0; i < nombre; i++) courant.add(debut + i);
    }
  }
  for (const [chemin, lignes] of resultat) if (lignes.size === 0) resultat.delete(chemin);
  return resultat;
}
```

`src/analyse/cobertura.ts` :

```ts
export type Couverture = { couvertes: number; total: number; pourcentage: number | null };

const normaliser = (chemin: string, sources: string[]): string => {
  let c = chemin.replace(/\\/g, '/');
  for (const s of sources) if (s && c.startsWith(s)) { c = c.slice(s.length); break; }
  return c.replace(/^\/workspace\/projet\//, '').replace(/^\.\//, '').replace(/^\//, '');
};

// Lecture volontairement minimale (aucune dépendance XML) : attributs filename, number et hits.
export function lireCobertura(xml: string): Map<string, Map<number, number>> {
  const sources = [...xml.matchAll(/<source>([^<]*)<\/source>/g)].map(m => m[1].trim().replace(/\\/g, '/').replace(/\/?$/, '/'));
  const resultat = new Map<string, Map<number, number>>();
  for (const bloc of xml.matchAll(/<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
    const chemin = normaliser(bloc[1], sources);
    const lignes = resultat.get(chemin) ?? new Map<number, number>();
    for (const l of bloc[2].matchAll(/<line\b[^>]*\bnumber="(\d+)"[^>]*\bhits="(\d+)"/g)) {
      const n = Number(l[1]);
      lignes.set(n, Math.max(lignes.get(n) ?? 0, Number(l[2])));
    }
    resultat.set(chemin, lignes);
  }
  return resultat;
}

export function couvertureLignesModifiees(modifiees: Map<string, Set<number>>, couvertures: Map<string, Map<number, number>>[]): Couverture {
  let total = 0;
  let couvertes = 0;
  for (const [chemin, lignes] of modifiees) {
    for (const n of lignes) {
      const passages = couvertures.map(c => c.get(chemin)?.get(n)).filter((h): h is number => h !== undefined);
      if (!passages.length) continue;
      total++;
      if (passages.some(h => h > 0)) couvertes++;
    }
  }
  return { couvertes, total, pourcentage: total ? Math.round((couvertes / total) * 100) : null };
}
```

Si `hits` précède `number` dans les sorties réelles du spike, adapter l'expression pour accepter les deux ordres, et ajouter le cas au test.

- [ ] **Step 4: Vérifier le succès**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p .`
Expected : tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyse/diff.ts src/analyse/cobertura.ts test/analyse
git commit -m "Analyse : lignes modifiées et couverture Cobertura des lignes modifiées"
```

---

### Task 4: Lecteurs des rapports d'outils

**Files:**
- Create: `src/analyse/rapports.ts`
- Test: `test/analyse/rapports.test.ts`

**Interfaces:**
- Produces :
  - `type Severite = 'critique' | 'haute' | 'moyenne' | 'basse'`
  - `type Constat = { outil: 'audit_npm' | 'audit_dotnet' | 'semgrep' | 'gitleaks'; severite: Severite; message: string; fichier: string | null }`
  - `lireTrx(xml: string): { total: number; echecs: number } | null` (attributs `total` et `failed` de `<Counters`)
  - `lireNpmAudit(json: string): Constat[] | null` (`vulnerabilities.<paquet>.severity` : critical / high / moderate / low)
  - `lireDotnetVulnerables(json: string): Constat[] | null` (`projects[].frameworks[].topLevelPackages[]` et `transitivePackages[]`, `vulnerabilities[].severity` : Critical / High / Moderate / Low ; paquet et version dans le message)
  - `lireSemgrep(json: string): Constat[] | null` (`results[].extra.severity` : ERROR → haute, WARNING → moyenne, INFO → basse ; `path:start.line` dans `fichier`)
  - `lireGitleaks(json: string): Constat[] | null` (tableau ; chaque fuite → `critique`, message `secret détecté (<RuleID>)`, fichier `<File>:<StartLine>` ; **jamais** `Secret` ni `Match`)
  - Toutes renvoient `null` sur une entrée illisible (JSON ou XML invalide, forme inattendue).

- [ ] **Step 1: Tests qui échouent**

`test/analyse/rapports.test.ts` :

```ts
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
```

- [ ] **Step 2: Vérifier l'échec**

Run : `node --disable-warning=ExperimentalWarning --test test/analyse/rapports.test.ts`
Expected : FAIL (module absent).

- [ ] **Step 3: Implémenter**

`src/analyse/rapports.ts` :

```ts
export type Severite = 'critique' | 'haute' | 'moyenne' | 'basse';
export type Constat = { outil: 'audit_npm' | 'audit_dotnet' | 'semgrep' | 'gitleaks'; severite: Severite; message: string; fichier: string | null };

type Json = any;
const json = (texte: string): Json | undefined => { try { return JSON.parse(texte); } catch { return undefined; } };
const SEVERITES: Record<string, Severite> = {
  critical: 'critique', high: 'haute', moderate: 'moyenne', medium: 'moyenne', low: 'basse', info: 'basse',
  error: 'haute', warning: 'moyenne',
};
const severite = (s: unknown): Severite => SEVERITES[String(s).toLowerCase()] ?? 'moyenne';

export function lireTrx(xml: string): { total: number; echecs: number } | null {
  const m = /<Counters\b[^>]*>/.exec(xml);
  const total = m && /\btotal="(\d+)"/.exec(m[0]);
  const echecs = m && /\bfailed="(\d+)"/.exec(m[0]);
  return total && echecs ? { total: Number(total[1]), echecs: Number(echecs[1]) } : null;
}

export function lireNpmAudit(texte: string): Constat[] | null {
  const j = json(texte);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  return Object.entries((j.vulnerabilities ?? {}) as Record<string, Json>).map(([nom, v]) => ({
    outil: 'audit_npm' as const, severite: severite(v?.severity), message: `${nom} : vulnérabilité ${v?.severity}`, fichier: null,
  }));
}

export function lireDotnetVulnerables(texte: string): Constat[] | null {
  const j = json(texte);
  if (!j || !Array.isArray(j.projects)) return null;
  const constats: Constat[] = [];
  for (const p of j.projects as Json[])
    for (const f of (p.frameworks ?? []) as Json[])
      for (const paquet of [...(f.topLevelPackages ?? []), ...(f.transitivePackages ?? [])] as Json[])
        for (const v of (paquet.vulnerabilities ?? []) as Json[])
          constats.push({ outil: 'audit_dotnet', severite: severite(v.severity), message: `${paquet.id} ${paquet.resolvedVersion} : vulnérabilité ${v.severity}`, fichier: null });
  return constats;
}

export function lireSemgrep(texte: string): Constat[] | null {
  const j = json(texte);
  if (!j || !Array.isArray(j.results)) return null;
  return (j.results as Json[]).map(r => ({
    outil: 'semgrep' as const, severite: severite(r.extra?.severity), message: `${r.check_id} : ${r.extra?.message ?? ''}`.trim(),
    fichier: r.path ? `${r.path}:${r.start?.line ?? '?'}` : null,
  }));
}

// La valeur du secret n'est jamais recopiée : seulement la règle et l'emplacement.
export function lireGitleaks(texte: string): Constat[] | null {
  const j = json(texte);
  if (!Array.isArray(j)) return null;
  return (j as Json[]).map(f => ({ outil: 'gitleaks' as const, severite: 'critique' as const, message: `secret détecté (${f.RuleID})`, fichier: `${f.File}:${f.StartLine}` }));
}
```

- [ ] **Step 4: Vérifier le succès**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p .`
Expected : tous PASS (adapter un lecteur, jamais un test, si une sortie réelle du spike diffère ; signaler l'écart).

- [ ] **Step 5: Commit**

```bash
git add src/analyse/rapports.ts test/analyse/rapports.test.ts
git commit -m "Analyse : lecture des rapports TRX, audits npm et .NET, Semgrep, gitleaks"
```

---

### Task 5: Signes de triche dans le diff

**Files:**
- Create: `src/analyse/triche.ts`
- Test: `test/analyse/triche.test.ts`

**Interfaces:**
- Produces : `signesDeTriche(patch: string): string[]` — messages lisibles, un par signe, avec le fichier :
  - `test supprimé dans <fichier>` : ligne retirée contenant `[Fact`, `[Theory`, `[Test]`, `it(`, `test(` dans un fichier de test (`/test|spec/i` dans le chemin) ;
  - `test désactivé dans <fichier>` : ligne ajoutée contenant `Skip =`, `Skip=`, `[Ignore`, `xit(`, `xdescribe(`, `.skip(`, `it.skip`, `describe.skip` ;
  - `test isolé dans <fichier>` : ligne ajoutée contenant `fit(`, `fdescribe(`, `it.only`, `describe.only` ;
  - `configuration de test ou de couverture modifiée : <fichier>` : fichier modifié dont le nom correspond à `karma.conf`, `.runsettings`, `coverlet`, `jest.config`, `vitest.config`, `Directory.Build.props`, `angular.json`.

- [ ] **Step 1: Test qui échoue**

`test/analyse/triche.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signesDeTriche } from '../../src/analyse/triche.ts';

const PATCH = `diff --git a/tests/FusionTests.cs b/tests/FusionTests.cs
--- a/tests/FusionTests.cs
+++ b/tests/FusionTests.cs
@@ -10,3 +10,2 @@
-    [Fact]
-    public void Fusion_GardeLesRemises() {}
+    [Fact(Skip = "temporaire")]
diff --git a/src/app/devis.spec.ts b/src/app/devis.spec.ts
--- a/src/app/devis.spec.ts
+++ b/src/app/devis.spec.ts
@@ -1 +1 @@
-  it('compare', () => {});
+  fit('compare', () => {});
diff --git a/karma.conf.js b/karma.conf.js
--- a/karma.conf.js
+++ b/karma.conf.js
@@ -5 +5 @@
-  check: { global: { lines: 80 } }
+  check: { global: { lines: 10 } }
diff --git a/src/Film.cs b/src/Film.cs
--- a/src/Film.cs
+++ b/src/Film.cs
@@ -1 +1 @@
-  // it( dans du code de prod
+  // rien
`;

test('tests supprimés, désactivés, isolés, configuration modifiée', () => {
  assert.deepEqual(signesDeTriche(PATCH), [
    'test supprimé dans tests/FusionTests.cs',
    'test désactivé dans tests/FusionTests.cs',
    'test supprimé dans src/app/devis.spec.ts',
    'test isolé dans src/app/devis.spec.ts',
    'configuration de test ou de couverture modifiée : karma.conf.js',
  ]);
});

test('diff sans signe', () => assert.deepEqual(signesDeTriche(''), []));
```

- [ ] **Step 2: Vérifier l'échec**

Run : `node --disable-warning=ExperimentalWarning --test test/analyse/triche.test.ts`
Expected : FAIL (module absent).

- [ ] **Step 3: Implémenter**

`src/analyse/triche.ts` :

```ts
const FICHIER_TEST = /test|spec/i;
const TEST_RETIRE = /\[(Fact|Theory|Test)\b|\b(it|test)\(/;
const DESACTIVE = /Skip\s*=|\[Ignore|\bxit\(|\bxdescribe\(|\.skip\(|\bit\.skip\b|\bdescribe\.skip\b/;
const ISOLE = /\bfit\(|\bfdescribe\(|\bit\.only\b|\bdescribe\.only\b/;
const CONFIGURATION = /(karma\.conf|\.runsettings$|coverlet|jest\.config|vitest\.config|Directory\.Build\.props$|angular\.json$)/i;

// Signalements déterministes : ils informent le reviewer, le QA et le contrôleur, sans bloquer seuls.
export function signesDeTriche(patch: string): string[] {
  const signes: string[] = [];
  const ajouter = (s: string) => { if (!signes.includes(s)) signes.push(s); };
  let fichier: string | null = null;
  for (const ligne of patch.split('\n')) {
    if (ligne.startsWith('diff --git ')) {
      fichier = /^diff --git a\/(.+?) b\//.exec(ligne)?.[1] ?? null;
      if (fichier && CONFIGURATION.test(fichier)) ajouter(`configuration de test ou de couverture modifiée : ${fichier}`);
      continue;
    }
    if (!fichier || ligne.startsWith('---') || ligne.startsWith('+++')) continue;
    const test = FICHIER_TEST.test(fichier);
    if (ligne.startsWith('-') && test && TEST_RETIRE.test(ligne)) ajouter(`test supprimé dans ${fichier}`);
    if (ligne.startsWith('+') && DESACTIVE.test(ligne)) ajouter(`test désactivé dans ${fichier}`);
    if (ligne.startsWith('+') && ISOLE.test(ligne)) ajouter(`test isolé dans ${fichier}`);
  }
  return signes;
}
```

Note : dans le patch du test, `-  it('compare'…)` supprimé puis `+  fit(…)` ajouté donne bien « test supprimé » puis « test isolé ». La configuration est signalée à l'en-tête `diff --git`, avant les lignes du fichier : l'ordre attendu par le test correspond à l'ordre de lecture.

- [ ] **Step 4: Vérifier le succès**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p .`
Expected : tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyse/triche.ts test/analyse/triche.test.ts
git commit -m "Analyse : signes de triche détectés dans le diff de la branche"
```

---

### Task 6: Assemblage de l'analyse

**Files:**
- Create: `src/analyse/analyse.ts`
- Test: `test/analyse/analyse.test.ts`

**Interfaces:**
- Consumes : Tasks 3 à 5.
- Produces :
  - `const OUTILS = ['tests_dotnet', 'audit_dotnet', 'tests_angular', 'audit_npm', 'semgrep', 'gitleaks'] as const` ; `type NomOutil`
  - `const LIBELLES_OUTILS: Record<NomOutil | 'couverture', string>` = `tests_dotnet: 'dotnet test'`, `audit_dotnet: 'dotnet list package --vulnerable'`, `tests_angular: 'ng test'`, `audit_npm: 'npm audit'`, `semgrep: 'Semgrep'`, `gitleaks: 'gitleaks'`, `couverture: 'couverture des lignes modifiées'`
  - `type StatutOutil = 'ok' | 'echec' | 'absent' | 'non_applicable'`
  - `type Analyse = { sha: string; base: string; outils: Record<NomOutil | 'couverture', StatutOutil>; tests: { total: number; echecs: number } | null; couverture: Couverture | null; constats: Constat[]; signalements: string[] }`
  - `FICHIERS_ANALYSE: string[]` : noms des fichiers de `/workspace/analyse` à relire (`sha`, `diff.patch`, `<outil>.code`, `<outil>.na` pour chaque outil, et les sorties de la Task 2).
  - `assemblerAnalyse(base: string, fichiers: Record<string, string | null>): Analyse` — règles :
    - outil avec `.na` → `non_applicable` ;
    - sans `.code` → `absent` ;
    - tests (`tests_*`) : code ≠ 0 → `echec`, code 0 → `ok`. Une sortie attendue (TRX pour .NET) illisible avec un code 0 → `absent` ;
    - audits, Semgrep, gitleaks : JSON illisible → `absent`, sinon `ok` (les constats portent la gravité) ;
    - `couverture` : `non_applicable` si les deux `tests_*` le sont. Sinon `ok` dès qu'au moins un Cobertura est lisible pour une stack de tests qui a tourné, `absent` sinon. Le pourcentage est calculé sur le diff ;
    - `tests` : somme des TRX lisibles (Angular n'a pas de compteur : seul son statut compte) ;
    - `sha` : contenu du fichier `sha` (sans espace) ; absent → `''`.

- [ ] **Step 1: Test qui échoue**

`test/analyse/analyse.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblerAnalyse, FICHIERS_ANALYSE } from '../../src/analyse/analyse.ts';

const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const DIFF = 'diff --git a/src/Film.cs b/src/Film.cs\n--- a/src/Film.cs\n+++ b/src/Film.cs\n@@ -1 +1,2 @@\n+a\n+b\n';
const COB = '<coverage><class filename="src/Film.cs"><line number="1" hits="1"/><line number="2" hits="0"/></class></coverage>';

const dotnetSeul = (): Record<string, string | null> => ({
  sha: `${SHA}\n`, 'diff.patch': DIFF,
  'tests_dotnet.code': '1\n', 'dotnet.trx': '<Counters total="5" failed="1" />', 'dotnet.cobertura.xml': COB,
  'audit_dotnet.code': '0', 'dotnet-vulnerables.json': JSON.stringify({ projects: [] }),
  'tests_angular.na': '', 'audit_npm.na': '',
  'semgrep.code': '0', 'semgrep.json': '{"results":[]}',
  'gitleaks.code': '0', 'gitleaks.json': '[]',
});

test('projet .NET : tests en échec, couverture calculée, Angular non applicable', () => {
  const a = assemblerAnalyse(BASE, dotnetSeul());
  assert.equal(a.sha, SHA);
  assert.deepEqual(a.outils, { tests_dotnet: 'echec', audit_dotnet: 'ok', tests_angular: 'non_applicable', audit_npm: 'non_applicable', semgrep: 'ok', gitleaks: 'ok', couverture: 'ok' });
  assert.deepEqual(a.tests, { total: 5, echecs: 1 });
  assert.deepEqual(a.couverture, { couvertes: 1, total: 2, pourcentage: 50 });
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
  const a = assemblerAnalyse(BASE, { sha: SHA, 'diff.patch': '', 'tests_dotnet.na': '', 'audit_dotnet.na': '', 'tests_angular.na': '', 'audit_npm.na': '', 'semgrep.code': '0', 'semgrep.json': '{"results":[]}', 'gitleaks.code': '0', 'gitleaks.json': '[]' });
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
```

- [ ] **Step 2: Vérifier l'échec**

Run : `node --disable-warning=ExperimentalWarning --test test/analyse/analyse.test.ts`
Expected : FAIL (module absent).

- [ ] **Step 3: Implémenter**

`src/analyse/analyse.ts` :

```ts
import { couvertureLignesModifiees, lireCobertura, type Couverture } from './cobertura.ts';
import { lignesModifiees } from './diff.ts';
import { lireDotnetVulnerables, lireGitleaks, lireNpmAudit, lireSemgrep, lireTrx, type Constat } from './rapports.ts';
import { signesDeTriche } from './triche.ts';

export const OUTILS = ['tests_dotnet', 'audit_dotnet', 'tests_angular', 'audit_npm', 'semgrep', 'gitleaks'] as const;
export type NomOutil = (typeof OUTILS)[number];
export type StatutOutil = 'ok' | 'echec' | 'absent' | 'non_applicable';
export type Analyse = {
  sha: string; base: string; outils: Record<NomOutil | 'couverture', StatutOutil>;
  tests: { total: number; echecs: number } | null; couverture: Couverture | null; constats: Constat[]; signalements: string[];
};

export const LIBELLES_OUTILS: Record<NomOutil | 'couverture', string> = {
  tests_dotnet: 'dotnet test', audit_dotnet: 'dotnet list package --vulnerable', tests_angular: 'ng test', audit_npm: 'npm audit',
  semgrep: 'Semgrep', gitleaks: 'gitleaks', couverture: 'couverture des lignes modifiées',
};

const SORTIES = ['dotnet.trx', 'dotnet.cobertura.xml', 'dotnet-vulnerables.json', 'angular.cobertura.xml', 'npm-audit.json', 'semgrep.json', 'gitleaks.json'];
export const FICHIERS_ANALYSE = ['sha', 'diff.patch', ...OUTILS.flatMap(o => [`${o}.code`, `${o}.na`]), ...SORTIES];

const RAPPORTS: Partial<Record<NomOutil, [string, (t: string) => Constat[] | null]>> = {
  audit_dotnet: ['dotnet-vulnerables.json', lireDotnetVulnerables], audit_npm: ['npm-audit.json', lireNpmAudit],
  semgrep: ['semgrep.json', lireSemgrep], gitleaks: ['gitleaks.json', lireGitleaks],
};

export function assemblerAnalyse(base: string, fichiers: Record<string, string | null>): Analyse {
  const lu = (nom: string) => fichiers[nom] ?? null;
  const constats: Constat[] = [];
  const statut = (o: NomOutil): StatutOutil => {
    if (lu(`${o}.na`) !== null) return 'non_applicable';
    const code = lu(`${o}.code`);
    if (code === null || !/^\s*\d+\s*$/.test(code)) return 'absent';
    const rapport = RAPPORTS[o];
    if (rapport) {
      const texte = lu(rapport[0]);
      const c = texte === null ? null : rapport[1](texte);
      if (c === null) return 'absent';
      constats.push(...c);
      return 'ok';
    }
    if (Number(code) !== 0) return 'echec';
    // Tests .NET « réussis » sans TRX lisible : la mesure manque.
    if (o === 'tests_dotnet' && lireTrx(lu('dotnet.trx') ?? '') === null) return 'absent';
    return 'ok';
  };
  const outils = Object.fromEntries(OUTILS.map(o => [o, statut(o)])) as Record<NomOutil, StatutOutil>;

  const trx = lireTrx(lu('dotnet.trx') ?? '');
  const stacksTestees = (['tests_dotnet', 'tests_angular'] as const).filter(o => outils[o] === 'ok' || outils[o] === 'echec');
  const couvertures = [
    outils.tests_dotnet === 'ok' || outils.tests_dotnet === 'echec' ? lu('dotnet.cobertura.xml') : null,
    outils.tests_angular === 'ok' || outils.tests_angular === 'echec' ? lu('angular.cobertura.xml') : null,
  ].filter((x): x is string => x !== null).map(lireCobertura).filter(c => c.size > 0);
  const toutesNonApplicables = outils.tests_dotnet === 'non_applicable' && outils.tests_angular === 'non_applicable';
  const statutCouverture: StatutOutil = toutesNonApplicables ? 'non_applicable' : stacksTestees.length && couvertures.length ? 'ok' : 'absent';
  const patch = lu('diff.patch') ?? '';

  return {
    sha: (lu('sha') ?? '').trim(),
    base,
    outils: { ...outils, couverture: statutCouverture },
    tests: trx,
    couverture: statutCouverture === 'ok' ? couvertureLignesModifiees(lignesModifiees(patch), couvertures) : null,
    constats,
    signalements: signesDeTriche(patch),
  };
}
```

- [ ] **Step 4: Vérifier le succès**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p .`
Expected : tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyse/analyse.ts test/analyse/analyse.test.ts
git commit -m "Analyse : assemblage des mesures, outil manquant reconnu comme absent"
```

---

### Task 7: Seuils par projet et moteur de règles QA

**Files:**
- Create: `src/taches/seuils.ts`, `src/analyse/regles.ts`
- Modify: `src/db.ts`, `src/config.ts`
- Test: `test/taches/seuils.test.ts`, `test/analyse/regles.test.ts`, `test/db.test.ts`, `test/config.test.ts`

**Interfaces:**
- Produces :
  - Table `seuils_projets (projet TEXT PRIMARY KEY, couverture_lignes INTEGER NOT NULL CHECK (couverture_lignes BETWEEN 0 AND 100))`.
  - `Config.seuilCouvertureLignes` (défaut 80, `BUREAU_SEUIL_COUVERTURE`, entier entre 0 et 100, sinon 80) et `Config.delaiAnalyseMs` (défaut 45 min).
  - `type Seuils = { couvertureLignes: number }` ; `lireSeuils(db, projet, defaut: number): Seuils` ; `definirSeuils(db, projet, s: Seuils): void` (entier 0 à 100, sinon `Error`).
  - `reglesQa(a: Analyse | null, seuils: Seuils, sortieQa: SortieQa, criteres: string[]): { verdict: 'go' | 'no_go'; declenchees: string[] }`, avec ces messages dans cet ordre :
    1. `analyse absente : aucune mesure` (a nul ; les autres règles d'analyse sont sautées) ;
    2. `outil non exécuté : <libellé>` pour chaque outil `absent`, dans l'ordre de `OUTILS` puis `couverture` ;
    3. `tests en échec (<n> sur <total>)`, ou `tests en échec (ng test)` / `tests en échec` selon la stack ;
    4. `faille <critique|haute> : <message>[ (<fichier>)]` pour chaque constat critique ou haut ;
    5. `couverture des lignes modifiées <p> % < <seuil> %` si le pourcentage n'est pas nul et est sous le seuil ;
    6. `verdict du QA : no-go` si l'agent dit no-go ;
    7. `critère <n> non rempli` pour chaque critère validé absent ou non rempli ;
    8. `aucun critère d’acceptation validé` si la liste est vide.
  - `verdict = declenchees.length ? 'no_go' : 'go'`. `verdictQa` de `pipeline.ts` est remplacé par `reglesQa` (Task 10).

- [ ] **Step 1: Tests qui échouent**

`test/taches/seuils.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../../src/db.ts';
import { definirSeuils, lireSeuils } from '../../src/taches/seuils.ts';

test('seuil par défaut, puis propre au projet', () => {
  const db = ouvrirBase(':memory:');
  assert.deepEqual(lireSeuils(db, 'Film', 80), { couvertureLignes: 80 });
  definirSeuils(db, 'Film', { couvertureLignes: 90 });
  assert.deepEqual(lireSeuils(db, 'Film', 80), { couvertureLignes: 90 });
  assert.deepEqual(lireSeuils(db, 'Addiff', 80), { couvertureLignes: 80 });
});

test('seuil hors bornes refusé', () => {
  const db = ouvrirBase(':memory:');
  for (const v of [-1, 101, 1.5, Number.NaN]) assert.throws(() => definirSeuils(db, 'Film', { couvertureLignes: v }));
});
```

`test/analyse/regles.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Analyse } from '../../src/analyse/analyse.ts';
import { reglesQa } from '../../src/analyse/regles.ts';

const analyse = (o: Partial<Analyse> = {}): Analyse => ({
  sha: 'a'.repeat(40), base: 'b'.repeat(40),
  outils: { tests_dotnet: 'ok', audit_dotnet: 'ok', tests_angular: 'non_applicable', audit_npm: 'non_applicable', semgrep: 'ok', gitleaks: 'ok', couverture: 'ok' },
  tests: { total: 12, echecs: 0 }, couverture: { couvertes: 9, total: 10, pourcentage: 90 }, constats: [], signalements: [], ...o,
});
const qaGo = { verdict: 'go' as const, criteres: [{ numero: 1, rempli: true, preuve: 'test vert' }] };
const seuils = { couvertureLignes: 80 };

test('tout est vert : go', () => {
  assert.deepEqual(reglesQa(analyse(), seuils, qaGo, ['Le PDF contient le synopsis']), { verdict: 'go', declenchees: [] });
});

test('couverture sous le seuil : message de la maquette', () => {
  const r = reglesQa(analyse({ couverture: { couvertes: 18, total: 25, pourcentage: 72 } }), seuils, qaGo, ['c']);
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
  assert.equal(reglesQa(analyse({ couverture: { couvertes: 0, total: 0, pourcentage: null } }), seuils, qaGo, ['c']).verdict, 'go');
});
```

`test/config.test.ts` : ajouter

```ts
test('seuil de couverture par défaut 80, surcharge bornée', () => {
  assert.equal(chargerConfig({}).seuilCouvertureLignes, 80);
  assert.equal(chargerConfig({ BUREAU_SEUIL_COUVERTURE: '90' }).seuilCouvertureLignes, 90);
  for (const v of ['-1', '101', 'abc', '']) assert.equal(chargerConfig({ BUREAU_SEUIL_COUVERTURE: v }).seuilCouvertureLignes, 80);
});
```

`test/db.test.ts` : ajouter `seuils_projets` à la liste attendue (changement de forme, à signaler).

- [ ] **Step 2: Vérifier l'échec**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected : FAIL (modules et table absents).

- [ ] **Step 3: Implémenter**

`src/db.ts`, ajouter au schéma :

```sql
CREATE TABLE IF NOT EXISTS seuils_projets (
  projet TEXT PRIMARY KEY, couverture_lignes INTEGER NOT NULL CHECK (couverture_lignes BETWEEN 0 AND 100)
);
```

`src/config.ts` : `Config` gagne `seuilCouvertureLignes: number; delaiAnalyseMs: number;` ; dans `chargerConfig` :

```ts
    seuilCouvertureLignes: entierEntre(env.BUREAU_SEUIL_COUVERTURE, 0, 100, 80),
    delaiAnalyseMs: 45 * 60_000,
```

avec, si aucune aide équivalente n'existe déjà (réutiliser `entierPositif` si sa forme convient) :

```ts
function entierEntre(valeur: string | undefined, min: number, max: number, defaut: number): number {
  if (valeur === undefined || !/^\d+$/.test(valeur.trim())) return defaut;
  const n = Number(valeur);
  return n >= min && n <= max ? n : defaut;
}
```

`src/taches/seuils.ts` :

```ts
import type { Base } from '../db.ts';

export type Seuils = { couvertureLignes: number };

// Seuils gardés par l'orchestrateur : jamais lus dans le dépôt, donc hors de portée de l'implémenteur.
export function lireSeuils(db: Base, projet: string, defaut: number): Seuils {
  const l = db.prepare('SELECT couverture_lignes AS c FROM seuils_projets WHERE projet = ?').get(projet) as { c: number } | undefined;
  return { couvertureLignes: l?.c ?? defaut };
}

export function definirSeuils(db: Base, projet: string, s: Seuils): void {
  if (!Number.isInteger(s.couvertureLignes) || s.couvertureLignes < 0 || s.couvertureLignes > 100) throw new Error('seuil de couverture attendu : entier entre 0 et 100');
  db.prepare('INSERT INTO seuils_projets (projet, couverture_lignes) VALUES (?, ?) ON CONFLICT (projet) DO UPDATE SET couverture_lignes = excluded.couverture_lignes')
    .run(projet, s.couvertureLignes);
}
```

`src/analyse/regles.ts` :

```ts
import type { z } from 'zod';
import type { SortieQa } from '../agents/definitions.ts';
import type { Seuils } from '../taches/seuils.ts';
import { LIBELLES_OUTILS, OUTILS, type Analyse } from './analyse.ts';

// Règles automatiques de la spec : l'agent QA peut dire no-go, jamais faire passer une mesure manquante ou mauvaise.
export function reglesQa(a: Analyse | null, seuils: Seuils, sortieQa: z.infer<typeof SortieQa>, criteres: string[]): { verdict: 'go' | 'no_go'; declenchees: string[] } {
  const d: string[] = [];
  if (!a) d.push('analyse absente : aucune mesure');
  else {
    for (const o of [...OUTILS, 'couverture'] as const) if (a.outils[o] === 'absent') d.push(`outil non exécuté : ${LIBELLES_OUTILS[o]}`);
    if (a.outils.tests_dotnet === 'echec') d.push(a.tests ? `tests en échec (${a.tests.echecs} sur ${a.tests.total})` : 'tests en échec');
    if (a.outils.tests_angular === 'echec') d.push('tests en échec (ng test)');
    for (const c of a.constats) if (c.severite === 'critique' || c.severite === 'haute') d.push(`faille ${c.severite} : ${c.message}${c.fichier ? ` (${c.fichier})` : ''}`);
    const p = a.couverture?.pourcentage;
    if (p !== null && p !== undefined && p < seuils.couvertureLignes) d.push(`couverture des lignes modifiées ${p} % < ${seuils.couvertureLignes} %`);
  }
  if (sortieQa.verdict !== 'go') d.push('verdict du QA : no-go');
  const remplis = new Set(sortieQa.criteres.filter(c => c.rempli).map(c => c.numero));
  criteres.forEach((_, i) => { if (!remplis.has(i + 1)) d.push(`critère ${i + 1} non rempli`); });
  if (criteres.length === 0) d.push('aucun critère d’acceptation validé');
  return { verdict: d.length ? 'no_go' : 'go', declenchees: d };
}
```

Si `SortieQa` est exporté comme valeur zod (c'est le cas en 2a), l'import `import type { SortieQa }` suffit pour `z.infer<typeof SortieQa>`.

- [ ] **Step 4: Vérifier le succès**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p .`
Expected : tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db.ts src/config.ts src/taches/seuils.ts src/analyse/regles.ts test
git commit -m "Seuils par projet gardés par l'orchestrateur, moteur de règles QA automatiques"
```

---

### Task 8: Commit de base de la tâche et SHA d'une copie

**Files:**
- Modify: `src/conteneurs/docker.ts`, `src/db.ts`, `src/taches/depot.ts`, `src/orchestrateur.ts`
- Test: `test/taches/depot.test.ts`, `test/db.test.ts`, `test-docker/conteneurs.test.ts`

**Interfaces:**
- Produces :
  - `lireShaVolume(docker, imageId, volume): Promise<string | null>` : `git -C /workspace/projet rev-parse HEAD` dans un conteneur jetable (volume en lecture seule, `HOME=/tmp`, `safe.directory '*'`). Renvoie le SHA si la sortie fait exactement 40 caractères hexadécimaux, sinon `null`.
  - Colonne `taches.commit_base TEXT`, ajoutée par `ALTER TABLE` sur une base existante comme `agent`. `Tache.commitBase: string | null` ; `definirCommitBase(db, id, sha)` (refuse tout ce qui n'est pas 40 hexadécimaux).
  - À la création d'une tâche (orchestrateur), juste après `preparerEspace` et avant `creerTache`, le SHA de la branche fraîchement créée est lu avec `lireShaVolume`. Sans SHA lisible : préparation impossible, même chemin d'erreur qu'un échec de `preparerEspace` (volume supprimé, journal, rien de créé). Sinon `definirCommitBase` juste après `creerTache`.

- [ ] **Step 1: Tests qui échouent**

`test/taches/depot.test.ts` :

```ts
test('commit de base enregistré, format vérifié', () => {
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: 'T-41', projet: 'Film', titre: 'Export PDF', cheminProjet: '/p', budgetUsd: 6 });
  assert.equal(lireTache(db, 'T-41').commitBase, null);
  definirCommitBase(db, 'T-41', 'a'.repeat(40));
  assert.equal(lireTache(db, 'T-41').commitBase, 'a'.repeat(40));
  assert.throws(() => definirCommitBase(db, 'T-41', 'main; rm -rf /'));
});
```

`test/db.test.ts`, dans le test de migration existant : vérifier aussi que `commit_base` est ajoutée à une ancienne table.

`test-docker/conteneurs.test.ts` :

```ts
test('SHA lu dans le volume d’une tâche', async () => {
  const id = `T-${Date.now() % 100000}`;
  await preparerEspace(docker, image, id, depot);
  try {
    assert.match((await lireShaVolume(docker, image, nomRessource(id))) ?? '', /^[0-9a-f]{40}$/);
  } finally {
    await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
  }
});
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected : FAIL (fonctions et colonne absentes).

- [ ] **Step 3: Implémenter**

`src/conteneurs/docker.ts` :

```ts
export async function lireShaVolume(docker: Docker, imageId: string, volume: string): Promise<string | null> {
  const script = `export HOME=/tmp && git config --global --add safe.directory '*' && git -C ${RACINE_PROJET} rev-parse HEAD`;
  const r = await executerJetable(docker, imageId, ['sh', '-c', script], [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }]);
  const sha = r.stdout.toString('utf8').trim();
  return r.code === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}
```

`src/db.ts` : `commit_base TEXT,` dans `CREATE TABLE taches` ; migration `ALTER TABLE taches ADD COLUMN commit_base TEXT` si absente (même mécanisme que `agent`).

`src/taches/depot.ts` : `Tache.commitBase` / `Ligne.commit_base` / `versTache` ; et

```ts
export function definirCommitBase(db: Base, id: string, sha: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`commit de base invalide pour ${id}`);
  db.prepare('UPDATE taches SET commit_base = ?, maj_le = ? WHERE id = ?').run(sha, maintenant(), id);
}
```

`src/orchestrateur.ts`, dans la création de tâche, après `await preparerEspace(...)` et dans le même `try` :

```ts
      base = await lireShaVolume(docker, manifeste.image, nomRessource(id));
      if (!base) throw new Error('commit de base illisible dans l’espace de la tâche');
```

Dans le `catch` existant, supprimer en plus le volume (`docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {})`) quand il a été créé, puis journaliser et relancer comme aujourd'hui. Après `creerTache(...)` : `definirCommitBase(db, id, base)`.

- [ ] **Step 4: Vérifier le succès**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p . && DOCKER_HOST=unix:///var/run/docker.sock node --disable-warning=ExperimentalWarning --test --test-timeout=900000 test-docker/conteneurs.test.ts`
Expected : tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src test test-docker/conteneurs.test.ts
git commit -m "Commit de base enregistré à la création de la tâche, SHA d'un volume lisible"
```

---

### Task 9: Exécution de l'analyse dans un conteneur durci

**Files:**
- Create: `src/analyse/execution.ts`, `test/fixtures/projet-dotnet/` (petit projet .NET : `Film.sln`, `Film/Film.csproj` avec `Film.cs`, `Film.Tests/Film.Tests.csproj` avec un test xUnit qui passe)
- Modify: `src/conteneurs/execution.ts` (extraire `envTache`)
- Test: `test-docker/analyse.test.ts`

**Interfaces:**
- Consumes : `DepsExecution`, `creerConteneurAgent`, `executerDans`, `preparerReseau`, `supprimerReseau`, `lireFichierVolume`, `assemblerAnalyse`, `FICHIERS_ANALYSE`, `LIBELLES_OUTILS`.
- Produces :
  - `envTache(jeton: string): string[]` exporté par `src/conteneurs/execution.ts` : la liste d'environnement que `lancerEtape` construit aujourd'hui (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY=<jeton>`, `BUREAU_JETON`, `HTTPS_PROXY`…, `NO_PROXY=passerelle`). `lancerEtape` l'utilise, sans changement de comportement.
  - `executerAnalyse(deps: DepsExecution, tacheId: string, volume: string, base: string): Promise<Analyse>` :
    - crée un jeton de tâche (durée `config.delaiAnalyseMs` + 10 min), un réseau de tâche et un conteneur agent sur `volume` (`creerConteneurAgent`, mêmes protections) ;
    - exécute `['bash', '/opt/analyse/analyser.sh', base]` avec `executerDans`, coupé à `config.delaiAnalyseMs` (conteneur supprimé) ;
    - dans un `finally` : conteneur supprimé, réseau supprimé, jeton révoqué ;
    - relit chaque fichier de `FICHIERS_ANALYSE` sous `/workspace/analyse/` avec `lireFichierVolume` (un fichier absent donne `null`), puis `assemblerAnalyse(base, fichiers)` ;
    - journalise une entrée par outil et une pour la couverture : `type: 'evenement'`, `commande: <libellé>`, `couche: '—'`, `decision: 'Autorisé'`, `decideur: 'Orchestrateur'`, `raison: 'analyse de review : <statut>'` ;
    - lève une `Error` si le conteneur n'a pas pu tourner, et `AnomalieIntegrite('analyse', …)` si `base` n'est pas un SHA de 40 hexadécimaux.

- [ ] **Step 1: Test qui échoue (Docker)**

`test-docker/analyse.test.ts`, sur le modèle de `test-docker/pipeline.test.ts` (orchestrateur réel, faux client Haiku, ordonnanceur arrêté). Le dépôt d'exemple est copié depuis `test/fixtures/projet-dotnet` dans un dossier temporaire. Il reçoit un commit de base, puis un commit qui modifie `Film/Film.cs` (une méthode nouvelle **non testée**) et ajoute `appsettings.secret.json` avec une fausse clé reconnue par gitleaks (`"aws_secret_access_key": "AKIA` + 16 caractères factices + `"`).

```ts
test('analyse réelle du projet .NET : tests verts, couverture des lignes modifiées, secret détecté', async () => {
  // o = orchestrateur démarré ; T créée par o.creerTache (commit de base enregistré) ; seconde commit appliquée dans le dépôt source AVANT creerTache.
  const tache = lireTache(o.db, T);
  const volume = await preparerCopieControle(docker, image, T);
  try {
    const a = await executerAnalyse(o.execution, T, volume, tache.commitBase!);
    assert.match(a.sha, /^[0-9a-f]{40}$/);
    assert.equal(a.outils.tests_dotnet, 'ok');
    assert.equal(a.outils.tests_angular, 'non_applicable');
    assert.equal(a.outils.semgrep, 'ok');
    assert.equal(a.outils.gitleaks, 'ok');
    assert.equal(a.outils.couverture, 'ok');
    assert.ok(a.tests && a.tests.total >= 1 && a.tests.echecs === 0);
    assert.ok(a.couverture && a.couverture.pourcentage !== null && a.couverture.pourcentage < 100, 'méthode non testée');
    assert.ok(a.constats.some(c => c.outil === 'gitleaks'));
    assert.ok(!JSON.stringify(a).includes('AKIA'), 'aucune valeur de secret');
    const journal = lireJournal(o.db, T).filter(e => e.raison.startsWith('analyse de review'));
    assert.equal(journal.length, 7);
  } finally {
    await supprimerCopieControle(docker, T);
  }
});
```

Le commit de base de la tâche doit être le commit **avant** les modifications. Créer donc la tâche sur le dépôt au commit de base, puis ajouter le second commit dans le **volume de la tâche** avec un conteneur jetable (même aide `executerSurVolume` que dans `test-docker/conteneurs.test.ts` : écrire les fichiers puis `git add` et `git commit`), avant `preparerCopieControle`. Pour que le test accède à `DepsExecution`, exposer `execution` sur l'objet `Orchestrateur` (type `DepsExecution`), si ce n'est pas déjà fait.

- [ ] **Step 2: Vérifier l'échec**

Run : `DOCKER_HOST=unix:///var/run/docker.sock npm run image && node --disable-warning=ExperimentalWarning --test --test-timeout=1800000 test-docker/analyse.test.ts`
Expected : FAIL (`executerAnalyse` absent).

- [ ] **Step 3: Implémenter**

Dans `src/conteneurs/execution.ts`, extraire puis utiliser dans `lancerEtape` :

```ts
// Aucun secret : ANTHROPIC_API_KEY porte le jeton de la tâche, que le proxy remplace par la vraie clé.
export function envTache(jeton: string): string[] {
  const passerelle = `http://passerelle:${PORT_INTERNE_PASSERELLE}`;
  const proxy = `http://tache:${jeton}@passerelle:${PORT_INTERNE_PASSERELLE}`;
  return [
    `ANTHROPIC_BASE_URL=${passerelle}`, `ANTHROPIC_API_KEY=${jeton}`, `BUREAU_JETON=${jeton}`,
    `HTTPS_PROXY=${proxy}`, `HTTP_PROXY=${proxy}`, `https_proxy=${proxy}`, `http_proxy=${proxy}`, 'NO_PROXY=passerelle', 'no_proxy=passerelle',
  ];
}
```

`src/analyse/execution.ts` :

```ts
import type Docker from 'dockerode';
import { creerConteneurAgent, executerDans, fichierParametresVides, lireFichierVolume, preparerReseau, supprimerReseau } from '../conteneurs/docker.ts';
import { envTache, type DepsExecution } from '../conteneurs/execution.ts';
import { verifierManifeste } from '../integrite/manifeste.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
import { ajouterAuJournal } from '../integrite/journal.ts';
import { assemblerAnalyse, FICHIERS_ANALYSE, LIBELLES_OUTILS, OUTILS, type Analyse } from './analyse.ts';

// Les outils tournent dans un conteneur durci, sans Claude Code : mesures produites hors de portée des agents.
export async function executerAnalyse(deps: DepsExecution, tacheId: string, volume: string, base: string): Promise<Analyse> {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new AnomalieIntegrite('analyse', `commit de base invalide pour ${tacheId}`);
  const imageId = verifierManifeste(deps.config.dossierDonnees, deps.cle, deps.racineDepot).image;
  const jeton = deps.jetons.creer(tacheId, deps.config.delaiAnalyseMs + 10 * 60_000);
  let conteneur: Docker.Container | undefined;
  let minuteur: NodeJS.Timeout | undefined;
  try {
    const reseau = await preparerReseau(deps.docker, tacheId);
    conteneur = await creerConteneurAgent(deps.docker, {
      tacheId, imageId, reseau, volume, env: envTache(jeton), ressources: deps.config.conteneur,
      parametresVides: fichierParametresVides(deps.config.dossierDonnees),
    });
    const c = conteneur;
    minuteur = setTimeout(() => void c.remove({ force: true }).catch(() => {}), deps.config.delaiAnalyseMs);
    await executerDans(c, ['bash', '/opt/analyse/analyser.sh', base], () => {});
  } finally {
    clearTimeout(minuteur);
    await conteneur?.remove({ force: true }).catch(() => {});
    await supprimerReseau(deps.docker, tacheId);
    deps.jetons.revoquer(tacheId);
  }
  const fichiers: Record<string, string | null> = {};
  for (const f of FICHIERS_ANALYSE) fichiers[f] = await lireFichierVolume(deps.docker, imageId, volume, `/workspace/analyse/${f}`);
  const analyse = assemblerAnalyse(base, fichiers);
  for (const o of [...OUTILS, 'couverture'] as const)
    ajouterAuJournal(deps.db, deps.cle, {
      tacheId, type: 'evenement', commande: LIBELLES_OUTILS[o], couche: '—', decision: 'Autorisé', decideur: 'Orchestrateur',
      raison: `analyse de review : ${analyse.outils[o]}`,
    });
  return analyse;
}
```

Si l'exécution échoue avant tout résultat (conteneur impossible), l'exception remonte : le pipeline la transforme en pause `erreur_api` (comportement de 2a). Un analyseur coupé par le délai laisse des outils sans `.code` : ils sont `absent`, donc no-go.

- [ ] **Step 4: Vérifier le succès**

Run : `DOCKER_HOST=unix:///var/run/docker.sock node --disable-warning=ExperimentalWarning --test --test-timeout=1800000 test-docker/analyse.test.ts && npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p .`
Expected : PASS. En cas d'échec, appliquer superpowers:systematic-debugging : lire les journaux `/workspace/analyse/*.log` de la copie, sans jamais affaiblir une assertion.

- [ ] **Step 5: Commit**

```bash
git add src test/fixtures/projet-dotnet test-docker/analyse.test.ts
git commit -m "Analyse lancée par l'orchestrateur dans un conteneur durci, mesures journalisées"
```

---

### Task 10: Analyse et règles dans le pipeline

**Files:**
- Modify: `src/pipeline/pipeline.ts`, `src/pipeline/prompts.ts`, `src/integrite/artefacts.ts`, `agents/reviewer.md`, `agents/qa.md`, `agents/patron-code.md`
- Test: `test/pipeline/pipeline.test.ts`, `test/pipeline/prompts.test.ts`

**Interfaces:**
- Consumes : `Analyse`, `reglesQa`, `lireSeuils`, `Tache.commitBase`.
- Produces :
  - `TypeArtefact` gagne `'analyse'` (JSON signé de l'`Analyse`).
  - `DepsPipeline` gagne `analyser: (tacheId: string, volume: string, base: string) => Promise<Analyse>` et `shaCopie: (volume: string) => Promise<string | null>`.
  - Étape **review** :
    - après la création de la copie : `commitBase` nul → `bloquee` (« commit de base inconnu : tâche créée avant l’analyse ») ;
    - sinon `analyser`, puis artefact `analyse` signé, puis prompt reconstruit (il inclut l'analyse), puis l'agent reviewer.
  - Étape **qa** :
    - après la création de la copie, `shaCopie(volume)` doit égaler le `sha` de l'analyse signée. Sinon `AnomalieIntegrite('analyse', 'la branche a changé depuis l’analyse de review')`, donc pause `integrite` ;
    - après l'agent, `reglesQa(analyse relue et vérifiée, lireSeuils(db, tache.projet, config.seuilCouvertureLignes), sortie, critères relus)` ;
    - artefact `verdict` = JSON `{ qa: <sortie>, regles: <declenchees>, verdict }` ;
    - transition avec ce verdict. `verdictQa` est supprimé (et son test remplacé par ceux de `reglesQa`, déjà écrits en Task 7).
  - `documentsEtape` :
    - `review` ajoute `analyse` s'il existe (absent avant l'analyse, au contrôle du relais) ;
    - `patron_code` et `qa` ajoutent `analyse` (obligatoire) ;
    - `implementation` avec `essaisQa > 0` ajoute `analyse`.

- [ ] **Step 1: Tests qui échouent**

Dans `test/pipeline/pipeline.test.ts` :

1. Imports : `definirCommitBase` (depot), `definirSeuils` (`../../src/taches/seuils.ts`), `type Analyse` (`../../src/analyse/analyse.ts`). Retirer `verdictQa` de l'import.
2. Constantes :

```ts
const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const ANALYSE_VERTE: Analyse = {
  sha: SHA, base: BASE,
  outils: { tests_dotnet: 'ok', audit_dotnet: 'ok', tests_angular: 'non_applicable', audit_npm: 'non_applicable', semgrep: 'ok', gitleaks: 'ok', couverture: 'ok' },
  tests: { total: 12, echecs: 0 }, couverture: { couvertes: 9, total: 10, pourcentage: 90 }, constats: [], signalements: [],
};
```

3. `banc()` : le type de `o` gagne `analyse?: Analyse; sha?: string; base?: string | null`. Après `creerTache` : `if (o.base !== null) definirCommitBase(db, 'T-41', o.base ?? BASE);`. Ajouter `const analyses: [string, string, string][] = [];` et, dans `deps` :

```ts
    analyser: async (id, volume, base) => { analyses.push([id, volume, base]); return o.analyse ?? ANALYSE_VERTE; },
    shaCopie: async () => o.sha ?? SHA,
```

Renvoyer aussi `analyses`.

4. Aide :

```ts
function aEtape(db: ReturnType<typeof ouvrirBase>, etape: 'review' | 'qa', analyse: Analyse = ANALYSE_VERTE) {
  valider(db);
  for (const [type, contenu] of [['resume', 'Export PDF ajouté.'], ['rapport', 'RAS'], ['avis_patron_code', 'Bien.']] as const)
    enregistrerArtefact(db, cle, 'T-41', type, contenu);
  if (etape === 'qa') enregistrerArtefact(db, cle, 'T-41', 'analyse', JSON.stringify(analyse));
  db.prepare("UPDATE taches SET etape = ? WHERE id = 'T-41'").run(etape);
}
const qaGo = { verdict: 'go', criteres: [{ numero: 1, rempli: true, preuve: 'ExportPdf_ContientSynopsis vert' }] };
```

5. Retirer les deux tests qui appellent `verdictQa` (« QA : critère absent ou non rempli… » et « verdictQa : aucun critère signé… ») : leurs cas sont repris par `test/analyse/regles.test.ts`. Signaler ce retrait. Le test « parcours du patron (plan) au QA » doit continuer à passer sans modification d'assertion, grâce au commit de base posé par `banc()` et à `ANALYSE_VERTE`.

6. Nouveaux tests :

```ts
test('review : analyse lancée sur la copie, signée, transmise au reviewer', async () => {
  const { db, deps, appels, analyses } = banc([{ rapport: 'RAS' }]);
  aEtape(db, 'review');
  const t = await avancer(deps, 'T-41');
  assert.equal(t.etape, 'patron_code');
  assert.deepEqual(analyses, [['T-41', 'bureau-t-41-controle', BASE]]);
  assert.equal(JSON.parse(lireArtefact(db, cle, 'T-41', 'analyse')!.contenu).sha, SHA);
  assert.ok(appels[0].prompt.includes('"analyse"'), 'analyse dans les documents du reviewer');
});

test('review sans commit de base : étape bloquée, aucun agent', async () => {
  const { db, deps, appels } = banc([], { base: null });
  aEtape(db, 'review');
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.raison], ['bloquee', 'commit de base inconnu : tâche créée avant l’analyse']);
  assert.equal(appels.length, 0);
});

test('QA : couverture sous le seuil du projet = no-go avec la règle déclenchée', async () => {
  const { db, deps } = banc([qaGo]);
  aEtape(db, 'qa', { ...ANALYSE_VERTE, couverture: { couvertes: 18, total: 25, pourcentage: 72 } });
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.etape, t.essaisQa], ['implementation', 1]);
  assert.deepEqual(JSON.parse(lireArtefact(db, cle, 'T-41', 'verdict')!.contenu).regles, ['couverture des lignes modifiées 72 % < 80 %']);
});

test('QA : seuil propre au projet appliqué', async () => {
  const { db, deps } = banc([qaGo]);
  definirSeuils(db, 'Film', { couvertureLignes: 70 });
  aEtape(db, 'qa', { ...ANALYSE_VERTE, couverture: { couvertes: 18, total: 25, pourcentage: 72 } });
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.etape, t.statut], ['validation', 'attente_humain']);
  assert.deepEqual(JSON.parse(lireArtefact(db, cle, 'T-41', 'verdict')!.contenu).regles, []);
});

test('QA : branche modifiée depuis l’analyse = pause d’intégrité, sans agent', async () => {
  const { db, deps, appels } = banc([qaGo], { sha: 'c'.repeat(40) });
  aEtape(db, 'qa');
  const t = await avancer(deps, 'T-41');
  assert.equal(t.raison?.split(' : ')[0], 'integrite');
  assert.equal(appels.length, 0);
});
```

Dans `test/pipeline/prompts.test.ts` :
- `analyse` est présente dans les documents de `patron_code` et `qa` ;
- son absence à l'étape `qa` lève `AnomalieIntegrite` ;
- elle est facultative à l'étape `review`.

- [ ] **Step 2: Vérifier l'échec**

Run : `node --disable-warning=ExperimentalWarning --test test/pipeline/pipeline.test.ts test/pipeline/prompts.test.ts`
Expected : FAIL.

- [ ] **Step 3: Implémenter**

`src/integrite/artefacts.ts` : ajouter `'analyse'` à `TypeArtefact`.

`src/pipeline/prompts.ts`, dans `documentsEtape` :

```ts
    case 'review': {
      const d: Record<string, string> = { spec: doc('spec'), criteres: doc('criteres'), plan: doc('plan'), resume: doc('resume') };
      // L'analyse est produite pendant l'étape : absente au contrôle du relais, présente pour le reviewer.
      const analyse = lireArtefact(db, cle, tache.id, 'analyse');
      if (analyse) d.analyse = analyse.contenu;
      return d;
    }
    case 'patron_code':
      return { spec: doc('spec'), criteres: doc('criteres'), resume: doc('resume'), rapport_review: doc('rapport'), analyse: doc('analyse') };
    case 'qa':
      return { spec: doc('spec'), criteres: doc('criteres'), rapport_review: doc('rapport'), avis_patron_code: doc('avis_patron_code'), analyse: doc('analyse') };
```

et, pour `implementation` quand `essaisQa > 0`, ajouter `analyse: doc('analyse')` à l'objet assigné.

Attention : l'analyse de la review précédente reste la dernière version signée jusqu'à la review suivante. C'est voulu : l'implémenteur reçoit les mesures qui ont conduit au no-go.

`src/pipeline/pipeline.ts` :
- `DepsPipeline` gagne `analyser` et `shaCopie` ;
- supprimer `verdictQa` ;
- importer `reglesQa`, `lireSeuils`, `type Analyse` ;
- dans le `try` principal, juste après `volume = …` :

```ts
    if (etape === 'review') {
      if (!tache.commitBase) {
        appliquer(db, tacheId, { type: 'demarrage' });
        appliquer(db, tacheId, { type: 'bloquee', detail: 'commit de base inconnu : tâche créée avant l’analyse' });
        return fin();
      }
      const analyse = await deps.analyser(tacheId, volume!, tache.commitBase);
      enregistrerArtefact(db, cle, tacheId, 'analyse', JSON.stringify(analyse, null, 2));
      prompt = promptEtape(db, cle, lireTache(db, tacheId));
    }
    if (etape === 'qa') {
      const analyse = lireAnalyse(db, cle, tacheId);
      if ((await deps.shaCopie(volume!)) !== analyse.sha) throw new AnomalieIntegrite('analyse', 'la branche a changé depuis l’analyse de review');
    }
```

avec, en haut du module :

```ts
function lireAnalyse(db: Base, cle: Buffer, tacheId: string): Analyse {
  const a = lireArtefact(db, cle, tacheId, 'analyse');
  if (!a) throw new AnomalieIntegrite('analyse', 'document manquant : analyse');
  return JSON.parse(a.contenu) as Analyse;
}
```

Note : `appliquer(… 'bloquee')` exige `en_cours`. La tâche est encore `prete` à ce moment (avant `executer`), d'où le `demarrage` qui précède. Vérifier ce point sur la machine à états. Si `bloquee` est accepté depuis `prete` dans le code réel, ne pas appliquer `demarrage`.

`let prompt` doit pouvoir être réassigné (c'est déjà un `let`).

- Dans le cas `qa` :

```ts
      case 'qa': {
        const s = lire(SortieQa);
        if (!s) { t = illisible(); break; }
        criteresQa = lireCriteres(lireArtefact(db, cle, tacheId, 'criteres')?.contenu ?? '');
        const seuils = lireSeuils(db, tache.projet, deps.config.seuilCouvertureLignes);
        const r = reglesQa(lireAnalyse(db, cle, tacheId), seuils, s, criteresQa);
        enregistrerArtefact(db, cle, tacheId, 'verdict', JSON.stringify({ qa: s, regles: r.declenchees, verdict: r.verdict }, null, 2));
        t = appliquer(db, tacheId, { type: 'etape_terminee', verdict: r.verdict });
        break;
      }
```

Ajouter à la fin de `agents/reviewer.md` :

```markdown
- Un rapport d'analyse signé (`analyse`) t'est fourni : il a été produit par l'orchestrateur, pas par un agent (tests, couverture des lignes modifiées, audits, Semgrep, gitleaks, signes de triche). Commente chaque mesure défavorable et chaque signalement ; ne contredis jamais une mesure sans preuve.
```

Ajouter à `agents/qa.md` :

```markdown
- Le rapport d'analyse signé (`analyse`) est une mesure de l'orchestrateur : un test en échec, une faille critique ou haute, une couverture sous le seuil ou un outil non exécuté donnent un no-go automatique, quel que soit ton verdict. Ton rôle : vérifier chaque critère et relancer les tests toi-même.
```

Ajouter à `agents/patron-code.md` :

```markdown
- Le rapport d'analyse signé (`analyse`) complète le rapport du reviewer : signale ce que ni l'un ni l'autre ne couvre.
```

- [ ] **Step 4: Vérifier le succès**

Run : `npm_config_script_shell=/bin/bash npm test 2>&1 | grep -E "^✖|^ℹ (pass|fail)" && node node_modules/typescript/bin/tsc -p .`
Expected : tous PASS. Les tests existants de `verdictQa` sont retirés avec la fonction ; leurs cas sont couverts par `test/analyse/regles.test.ts` (signaler ce retrait dans le rapport).

- [ ] **Step 5: Commit**

```bash
git add src agents test
git commit -m "Pipeline : analyse signée en review, règles automatiques et contrôle du SHA en QA"
```

---

### Task 11: Câblage et parcours complet

**Files:**
- Modify: `src/orchestrateur.ts`, `test-docker/pipeline.test.ts`
- Test: `test-docker/pipeline.test.ts`, `test-docker/analyse.test.ts`

**Interfaces:**
- Consumes : `executerAnalyse`, `lireShaVolume`.
- Produces : `DepsPipeline.analyser = (id, volume, base) => executerAnalyse(execution, id, volume, base)` ; `DepsPipeline.shaCopie = volume => lireShaVolume(docker, manifeste.image, volume)`.

- [ ] **Step 1: Câbler**

Dans `src/orchestrateur.ts`, ajouter `analyser` et `shaCopie` à l'objet `DepsPipeline`.

- [ ] **Step 2: Mettre à jour le parcours Docker**

Le dépôt piège de `test-docker/pipeline.test.ts` n'a ni .NET ni Angular : tests et audits `non_applicable`, couverture `non_applicable`, Semgrep et gitleaks `ok`. Le parcours doit toujours finir en `validation` / `attente_humain`. Ajouter :
- l'artefact `analyse` se lit sans anomalie ;
- le verdict contient `regles: []` ;
- le journal contient 7 entrées `analyse de review : …`.

- [ ] **Step 3: Lancer**

Run :

```bash
export npm_config_script_shell=/bin/bash DOCKER_HOST=unix:///var/run/docker.sock
npm run image
npm test && node node_modules/typescript/bin/tsc -p .
node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=1800000 test-docker/pipeline.test.ts test-docker/analyse.test.ts test-docker/bout-en-bout.test.ts test-docker/conteneurs.test.ts
```

Expected : tout vert. Consigner les résultats exacts dans le rapport.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrateur.ts test-docker/pipeline.test.ts
git commit -m "Analyse et règles QA câblées, parcours complet vérifié dans Docker"
```

---

## Couverture de la spec par ce plan

| Exigence | Tâche |
| --- | --- |
| Reviewer : couverture du code ajouté ou modifié, pas du projet entier | 3, 6, 10 |
| Outils : Coverlet / `ng test --code-coverage`, Semgrep, `dotnet list package --vulnerable`, `npm audit`, gitleaks | 1, 2, 4, 9 (Coverlet remplacé par `dotnet-coverage`, Cobertura identique) |
| Signale tout test désactivé, assertion supprimée, seuil abaissé | 5 (tests supprimés, désactivés, isolés, configuration modifiée) |
| No-go automatique : test en échec, faille critique ou haute, couverture < 80 % du nouveau code, critère non rempli, outil n'ayant pas tourné | 6, 7, 10 |
| Seuils configurables par projet, hors de portée de l'implémenteur | 7 |
| Reviewer et QA dans un conteneur neuf, branche protégée ; le QA relance les tests | 2a + 10 (SHA vérifié) |
| Rapports signés à leur création | 10 (artefacts `analyse` et `verdict`) |
| Mesure manquante = no-go | 6, 7 |
| Journal : outils de l'orchestrateur, raison « analyse de review » | 9 |

Reporté :
- **2c** : écran « Relier un projet » qui règle les seuils (la fonction `definirSeuils` est prête), affichage du rapport en construction et des règles déclenchées.
- **Phase 3** : diff et rapports dans mon bureau de validation.
- **Hors V1** : ReportGenerator, Roslyn et ESLint comme mesures, couverture des branches.
