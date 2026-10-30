# Spike : outils d'analyse dans l'image, versions et formats réels

Date : 2026-10-30. Phase 2b, Task 1.

Banc : image d'essai construite à partir de `conteneur/Dockerfile` (non modifié), avec les outils ajoutés.
Tout a tourné en tant que `node` (uid 1000), avec `--read-only --tmpfs /tmp --cap-drop=ALL
--security-opt no-new-privileges --memory 4g --cpus 2 --pids-limit 1024`, et `/workspace` en volume inscriptible.
`HOME`, `DOTNET_CLI_HOME`, `NUGET_PACKAGES` et `npm_config_cache` pointaient sous `/workspace/.analyse-home`.

- Restauration NuGet / npm, `dotnet list package --vulnerable` et `npm audit` : réseau bridge Docker.
  La passerelle n'a **pas** été testée ici (voir « Points ouverts »).
- Semgrep et gitleaks : `--network none`.
- Aucun appel à l'API Anthropic.

## 1. Versions retenues

| Outil | Version | Source | SHA-256 (vérifié en téléchargeant) |
|---|---|---|---|
| Image de base | `node:24-slim@sha256:c86ecead…920c` (Debian 12.15 bookworm) | inchangée | — |
| SDK .NET 9 | **9.0.320** (runtime 9.0.22, sortie le 2026-10-25) | `https://builds.dotnet.microsoft.com/dotnet/Sdk/9.0.320/dotnet-sdk-9.0.320-linux-x64.tar.gz` | `83374176f286b61298248b464f09198107ee3f42b6a8f52c6b82f0ca0566156e` |
| Runtime ASP.NET Core 8 (contient Microsoft.NETCore.App 8) | **8.0.33** (2026-10-25) | `https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/8.0.33/aspnetcore-runtime-8.0.33-linux-x64.tar.gz` | `1ce73ddba660cd83103eed9f54e73cecfb61f515109e8f264dff8feb82b43693` |
| `dotnet-coverage` (outil global) | **18.12.0** (2026-10-06) | nuget.org, `dotnet tool install` | nupkg : `9801be478cc1da9b4c911563c7549bcf018b12a525dfa56e9edc33cc60ab66ef` |
| Semgrep (pip, venv `/opt/semgrep`) | **1.183.0** (publiée le 2026-10-29) | PyPI | roue `manylinux_2_34_x86_64` : `f36115c4d0cb43056ceb308273421a2f6a35e055e7e029601e130850f836646e` |
| gitleaks | **8.30.1** (2026-03-21) | `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz` | `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (identique au `checksums.txt` officiel) |
| Chromium (paquet Debian) | **156.0.8078.73-1~deb12u1** | `apt-get install chromium` (bookworm-security) | — (paquet signé par Debian) |
| Python (pour le venv Semgrep) | 3.11.2-1+b1 | `python3-venv` Debian | — |
| ICU | `libicu72` 72.1-3+deb12u1 | Debian | — |

Les SHA-512 publiés par Microsoft dans `release-metadata/{9.0,8.0}/releases.json` correspondent aux archives
téléchargées. Les SHA-256 ci-dessus ont été calculés sur ces mêmes archives.

Dépendances Python installées avec `semgrep==1.183.0` (`pip freeze`, pour un éventuel `--require-hashes`) :
annotated-types 0.8.0, anyio 4.15.1, attrs 26.1.0, boltons 21.0.0, bracex 3.2, certifi 2026.10.23, cffi 2.1.1,
charset-normalizer 3.5.2, click 8.4.2, click-option-group 0.5.9, colorama 0.4.6, cryptography 50.0.2,
exceptiongroup 1.2.2, face 26.0.1, glom 25.12.0, googleapis-common-protos 1.76.0, h11 0.16.0, httpcore 1.0.9,
httpx 0.28.1, httpx-sse 0.4.3, idna 3.20, importlib_metadata 8.7.1, jsonschema 4.25.1,
jsonschema-specifications 2025.9.1, markdown-it-py 4.2.0, mcp 1.29.0, mdurl 0.1.2, opentelemetry-* 1.37.0 / 0.58b0,
packaging 26.3, peewee 3.19.0, protobuf 6.33.6, pycparser 3.12, pydantic 2.14.2, pydantic-settings 2.16.2,
pydantic_core 2.50.2, Pygments 2.21.0, PyJWT 2.15.1, python-dotenv 1.2.4, python-multipart 0.0.32,
referencing 0.37.0, requests 2.34.2, rich 15.0.0, rpds-py 2026.9.1, ruamel.yaml 0.19.1, ruamel.yaml.clib 0.2.15,
semantic-version 2.10.0, sse-starlette 3.6.0, starlette 1.10.0, tomli 2.4.1, typing-inspection 0.4.4,
typing_extensions 4.16.0, urllib3 2.8.0, uvicorn 0.54.0, wcmatch 8.5.2, wrapt 1.17.3, zipp 4.1.2.

## 2. Image d'essai

Bloc ajouté après l'installation de Claude Code (le reste du Dockerfile est identique) :

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends chromium python3-venv curl libicu72 && rm -rf /var/lib/apt/lists/*
ARG DOTNET_SDK_VERSION=9.0.320
ARG DOTNET_SDK_SHA256=83374176f286b61298248b464f09198107ee3f42b6a8f52c6b82f0ca0566156e
ARG ASPNET8_VERSION=8.0.33
ARG ASPNET8_SHA256=1ce73ddba660cd83103eed9f54e73cecfb61f515109e8f264dff8feb82b43693
RUN mkdir -p /usr/share/dotnet \
 && curl -fsSL -o /tmp/sdk.tar.gz "https://builds.dotnet.microsoft.com/dotnet/Sdk/${DOTNET_SDK_VERSION}/dotnet-sdk-${DOTNET_SDK_VERSION}-linux-x64.tar.gz" \
 && echo "${DOTNET_SDK_SHA256}  /tmp/sdk.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/sdk.tar.gz -C /usr/share/dotnet && rm /tmp/sdk.tar.gz \
 && curl -fsSL -o /tmp/aspnet.tar.gz "https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/${ASPNET8_VERSION}/aspnetcore-runtime-${ASPNET8_VERSION}-linux-x64.tar.gz" \
 && echo "${ASPNET8_SHA256}  /tmp/aspnet.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/aspnet.tar.gz -C /usr/share/dotnet ./shared && rm /tmp/aspnet.tar.gz \
 && ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false
RUN DOTNET_CLI_HOME=/tmp/dch dotnet tool install --tool-path /opt/dotnet-outils dotnet-coverage --version 18.12.0 \
 && ln -s /opt/dotnet-outils/dotnet-coverage /usr/local/bin/dotnet-coverage && rm -rf /tmp/dch
RUN python3 -m venv /opt/semgrep && /opt/semgrep/bin/pip install --no-cache-dir semgrep==1.183.0 \
 && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep
ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
RUN curl -fsSL -o /tmp/gitleaks.tar.gz "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
 && echo "${GITLEAKS_SHA256}  /tmp/gitleaks.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks && rm /tmp/gitleaks.tar.gz
```

Vérification (conteneur durci, `node`, racine en lecture seule) :

```
$ dotnet --list-sdks
9.0.320 [/usr/share/dotnet/sdk]
$ dotnet --list-runtimes
Microsoft.AspNetCore.App 8.0.33 [/usr/share/dotnet/shared/Microsoft.AspNetCore.App]
Microsoft.AspNetCore.App 9.0.22 [/usr/share/dotnet/shared/Microsoft.AspNetCore.App]
Microsoft.NETCore.App 8.0.33 [/usr/share/dotnet/shared/Microsoft.NETCore.App]
Microsoft.NETCore.App 9.0.22 [/usr/share/dotnet/shared/Microsoft.NETCore.App]
$ semgrep --version          → 1.183.0
$ gitleaks version           → 8.30.1
$ chromium --version         → Chromium 156.0.8078.73 built on Debian GNU/Linux 12 (bookworm)
$ dotnet-coverage --version  → 18.12.0+e67518936dc54d459b37375c5eef5dc89f05d535
```

**Taille** : l'image d'essai pèse **2,53 Go**, contre 620 Mo pour `bureau-agent:local`. Détail : SDK et runtimes
.NET 667 Mo, venv Semgrep 381 Mo, Chromium 348 Mo, dotnet-coverage 94 Mo, gitleaks 21 Mo. Construction à froid :
environ 1 min sur ce poste, téléchargements en cache exclus.

## 3. Règles Semgrep hors ligne

Les règles ne sont **pas versionnées**, car leur licence n'est pas libre (voir § 7 et E19). Elles sont récupérées
à chaque construction de l'image (`npm run image`) depuis deux jeux du registre :
- `https://semgrep.dev/c/p/csharp` : 27 règles le 2026-10-30 ;
- `https://semgrep.dev/c/p/typescript` : 74 règles le 2026-10-30, pour JavaScript et TypeScript.

Elles sont concaténées sans modification sous une seule clé `rules:` dans `/opt/analyse/semgrep-regles.yml`, en
lecture seule. Le fichier n'est pas figé par un SHA-256, puisque le registre le modifie sans changer de version.
C'est le digest de l'image, inscrit au manifeste signé, qui fige les règles réellement utilisées. La construction
affiche le nombre de règles et le SHA-256 de chaque jeu, pour la traçabilité.

Le jour du spike, les empreintes valaient `f834ed6c…e69d` pour p/csharp et `967e551f…5395` pour p/typescript,
pour 101 règles au total. Ces valeurs ne servent que d'indication et ne sont pas vérifiées à la construction.

Si le téléchargement échoue, **la construction de l'image échoue** : `curl -f`, `set -e`. Elle échoue aussi dans
trois autres cas, ce qui évite toute image construite avec un fichier de règles vide ou altéré :
- la réponse ne commence pas par `rules:` (page d'erreur ou de connexion, par exemple) ;
- la réponse ne contient aucune règle ;
- le fichier réuni n'est pas accepté par un scan Semgrep hors ligne d'un fichier C# vide.

`p/default` a été écarté : 2,5 Mo et 1 073 règles, presque toutes pour d'autres langages.

Commande vérifiée sous `--network none` (règles montées en lecture seule à `/opt/analyse/semgrep-regles.yml`) :

```
cd /workspace/projet
semgrep scan --config /opt/analyse/semgrep-regles.yml --json --metrics=off --disable-version-check \
  --output /workspace/analyse/semgrep.json src/Demo.Lib/Remise.cs config/aws.env
```

Durée : environ 2 s. Aucun accès réseau tenté. `HOME` doit être inscriptible (Semgrep y écrit `~/.semgrep`).

## 4. Sorties réelles et codes de retour

Projet d'exemple (scratchpad, non commité) : solution `Demo.sln`, avec `src/Demo.Lib` (net8.0,
`Newtonsoft.Json` 12.0.1 volontairement vulnérable) et `tests/Demo.Tests` (xUnit, net8.0, un test qui passe et
un qui échoue).

- Commit de base `d3bc857…`.
- Commit `2f9c4c7…` : ajoute une garde à `Appliquer`, une méthode `CodeValide` (Regex avec un délai de
  10 min, que Semgrep signale) et `config/aws.env` avec une fausse clé AWS.

Chaque fichier de `test/fixtures/analyse/` est la sortie brute de la commande correspondante, à deux
exceptions près : `gitleaks.json`, où `Secret` et `Match` sont remplacés par `"<retiré>"`, et `diff.patch`, où les
deux valeurs du faux secret sont remplacées par `<retiré>` (les numéros de ligne ne changent pas).

| Fichier | Commande exacte (dans `/workspace/projet`) | Code de retour observé |
|---|---|---|
| — | `dotnet restore Demo.sln` | 0 |
| `dotnet.trx`, `dotnet.cobertura.xml` | `dotnet-coverage collect -f cobertura -o $O/dotnet.cobertura.xml "dotnet test Demo.sln --no-restore --logger trx;LogFileName=$O/dotnet.trx"` | **1** si un test échoue (0 si tous passent) ; les deux fichiers sont écrits dans tous les cas |
| `dotnet-vulnerables.json` | `dotnet list Demo.sln package --vulnerable --include-transitive --format json` | **0 même avec une vulnérabilité** ; 1 sans réseau ni cache, avec un texte d'erreur (pas du JSON) sur stdout |
| `npm-audit.json` | `npm audit --json` (petit projet `lodash@4.17.20` + `minimist@1.2.5`) | **1** avec des vulnérabilités, 0 sans (projet Angular 22 neuf : `"vulnerabilities": {}`) ; **1 aussi en cas d'erreur réseau**, avec un JSON sans `vulnerabilities` (voir écart E6) |
| `semgrep.json` | voir § 3 | **0 avec ou sans résultat** ; 2 si un fichier cible n'existe pas ; 1 avec `--error` et des résultats |
| `gitleaks.json` | `gitleaks git --log-opts="<base>..HEAD" --report-format json --report-path $O/gitleaks.json --exit-code 0` | 0 ; `[]` si aucune fuite ; **0 et `[]` aussi si la base n'existe pas** (voir écart E8) |
| `diff.patch` | `git diff -U0 <base>..HEAD` | 0 ; 128 si la base n'existe pas |
| `angular.cobertura.xml` | `ng test --watch=false --coverage --runner-config /opt/analyse/karma.conf.cjs` (Angular 22, lanceur Karma) | 0 ; **1 si un test échoue**, et le Cobertura est écrit quand même |

Sur cet exemple, la couverture des lignes modifiées attendue par la Task 3 est de 1 / 7 = 14 %. Lignes modifiées
de `src/Demo.Lib/Remise.cs` : 1, 2, 9 à 12, 20 à 25. Lignes instrumentées : 9 (1 passage), 10, 11, 22 à 25
(0 passage).

## 5. Forme des champs utiles

**TRX** (`dotnet.trx`) : `<ResultSummary outcome="Failed"><Counters total="2" executed="2" passed="1" failed="1"
error="0" timeout="0" aborted="0" … />`. Le premier `<Counters` du fichier est le bon. `failed` est un attribut
distinct de `error`.

**Cobertura .NET** (`dotnet-coverage`) :
- le fichier commence par un **BOM UTF-8** ;
- **pas de `<sources>`** ;
- `class@filename` **absolu** : `/workspace/projet/src/Demo.Lib/Remise.cs` ;
- les classes des **projets de test** figurent aussi (`/workspace/projet/tests/Demo.Tests/RemiseTests.cs`) ;
- `<line number="9" hits="1" branch="True" condition-coverage="50% (2/4)">`, avec `number` avant `hits` ;
- chaque ligne apparaît deux fois, sous `<method><lines>` et sous `<class><lines>`. Les lignes de branche ont
  des enfants `<conditions>`, donc **pas** d'auto-fermeture.

**Cobertura Angular** (karma-coverage / istanbul) :
- `<!DOCTYPE coverage SYSTEM "…coverage-04.dtd">` ;
- `<sources><source>/workspace/front</source></sources>`, **sans `/` final**. C'est le dossier du projet Angular
  (là où se trouve `angular.json`), pas forcément la racine du dépôt ;
- `class@filename` **relatif à ce source** : `src/app/remise.ts` ;
- `<line number="2" hits="1" branch="true" condition-coverage="…"/>`, auto-fermée, avec `number` avant `hits` ;
- `<method name="…" hits="1" signature="()V">` porte aussi un `hits` ;
- les templates figurent comme classes (`filename="src/app/app.html"`), avec des numéros de ligne du code généré
  (187 à 344) qui ne correspondent pas au fichier HTML.

**npm audit** (`auditReportVersion: 2`) :
`{ "auditReportVersion": 2, "vulnerabilities": { "<paquet>": { "name", "severity": "critical|high|moderate|low|info",
"isDirect", "via": [...], "effects", "range", "nodes", "fixAvailable" } }, "metadata": { "vulnerabilities":
{ "info", "low", "moderate", "high", "critical", "total" }, "dependencies": {…} } }`.

En erreur, `npm audit` renvoie 1 et le JSON suivant :
`{ "message": "request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org", "error": { "summary": "", "detail": "" } }`.

**dotnet list package --vulnerable** :
`{ "version": 1, "parameters": "--vulnerable --include-transitive", "sources": [...], "projects": [ { "path":
"/workspace/projet/src/Demo.Lib/Demo.Lib.csproj", "frameworks": [ { "framework": "net8.0", "topLevelPackages":
[ { "id", "requestedVersion", "resolvedVersion", "vulnerabilities": [ { "severity": "High", "advisoryurl" } ] } ] } ] },
{ "path": "/workspace/projet/tests/Demo.Tests/Demo.Tests.csproj" } ] }`.

Quand un projet n'a aucune vulnérabilité, **`frameworks` est absent**. Quand il n'y a pas de transitif vulnérable,
**`transitivePackages` est absent** (pas un tableau vide).

**Semgrep** : `{ "version": "1.183.0", "results": [ { "check_id", "path": "src/Demo.Lib/Remise.cs", "start":
{ "line": 23, "col", "offset" }, "end": {…}, "extra": { "message", "metadata": {…}, "severity": "WARNING",
"fingerprint": "requires login", "lines": "requires login", "engine_kind": "OSS" } } ], "errors": [], "paths":
{ "scanned": [...] }, "time": {…} }`.

`check_id` est **préfixé par le chemin du fichier de règles** :
`opt.analyse.csharp.lang.security.regular-expression-dos.regular-expression-dos-infinite-timeout.regular-expression-dos-infinite-timeout`.
`path` est relatif au dossier courant.

**gitleaks** : tableau. Chaque entrée contient `RuleID`, `Description`, `StartLine`, `EndLine`,
`StartColumn`, `EndColumn`, `Match`, `Secret`, `File` (relatif au dépôt), `SymlinkFile`, `Commit`, `Entropy`,
`Author`, `Email`, `Date`, `Message`, `Tags`, `Fingerprint` (`<commit>:<fichier>:<règle>:<ligne>`, sans la valeur).

## 6. Écarts avec les Tasks 2 à 9

- **E1 (Task 2, installation .NET).** Le plan installe via `dotnet-install.sh`, vérifié par SHA-256. Ce script
  n'est pas versionné : il est servi en continu à la même URL (SHA-256 du jour :
  `082f7685e156738a1b2e2ed8381a621870d4ce8e8c59278034556f05c186eb2e`), donc la vérification casserait à chaque
  mise à jour. Mieux vaut télécharger directement les archives versionnées du SDK et du runtime, avec leur SHA-256
  (§ 2). Il ne faut extraire que `./shared` de l'archive ASP.NET Core 8, pour ne pas écraser `dotnet` et
  `LICENSE` du SDK 9.
- **E2 (Task 2, paquets apt).** `libicu-dev` est inutile : `libicu72` suffit (runtime seulement). `chromium` ne
  peut pas être figé par `=version` de façon durable, car bookworm-security retire les anciennes versions. La version
  observée est 156.0.8078.73-1~deb12u1 ; l'image de base est figée par digest, mais `apt-get update` prend la
  version courante. Option : figer et accepter de mettre à jour la version à chaque reconstruction qui échoue.
- **E3 (Task 2, dotnet-coverage et Semgrep).** `dotnet tool install` et `pip install` ne vérifient pas un SHA-256
  fourni par nous : NuGet vérifie la signature du dépôt, pip rien. Pour respecter la contrainte « binaires vérifiés
  par SHA-256 », on peut :
  - télécharger le nupkg avec `curl`, vérifier
    `9801be478cc1da9b4c911563c7549bcf018b12a525dfa56e9edc33cc60ab66ef`, puis
    `dotnet tool install --add-source <dossier>` ;
  - pour Semgrep, `pip install --require-hashes` avec la liste du § 1, ou au moins vérifier la roue principale.
  À trancher en Task 2.
- **E4 (Task 2, Karma et Angular récents).** La commande du plan (`ng test --code-coverage --karma-config …`) ne
  fonctionne qu'avec les builders `@angular/build:karma` (projets Angular 20 générés, maquette : Angular 19 et 20)
  et `@angular-devkit/build-angular:karma`. Avec Angular 21 et plus, `ng new` génère `@angular/build:unit-test`.
  Ce builder refuse ces options (`Unknown arguments`) et attend `--coverage --runner-config <fichier>` ; il ignore
  `--coverage-reporters` avec Karma. Vérifié :
  - Angular 20.3.42 : `ng test --watch=false --code-coverage --karma-config K` → Cobertura écrit. `--coverage
    --runner-config` → `Error: Unknown arguments: coverage, runner-config` ;
  - Angular 22.2.5 (`--test-runner=karma`) : `ng test --watch=false --coverage --runner-config K` → Cobertura écrit.
  Le script doit donc lire le builder de la cible `test` dans `angular.json` (ou essayer une forme puis l'autre).
- **E5 (Task 2, `karma.conf.cjs`).** Quand une configuration Karma est fournie, Angular n'applique plus ses
  réglages intégrés. Sans `karma.conf.js` dans le projet, cas par défaut depuis Angular 15, le `try { require }`
  du plan donne `ReferenceError: describe is not defined` : il n'y a ni `frameworks` ni `plugins`. Version
  vérifiée sur Angular 20 (avec et sans `karma.conf.js` du projet) et sur Angular 22 :

  ```js
  const path = require('node:path');
  const fs = require('node:fs');
  const { createRequire } = require('node:module');
  module.exports = function (config) {
    const projet = path.join(process.cwd(), 'karma.conf.js');
    if (fs.existsSync(projet)) {
      require(projet)(config);
    } else {
      const requireProjet = createRequire(process.cwd() + '/');
      config.set({
        frameworks: ['jasmine'],
        plugins: ['karma-jasmine', 'karma-chrome-launcher', 'karma-coverage'].map(p => requireProjet(p)),
        reporters: ['progress'],
      });
    }
    config.set({
      browsers: ['ChromeHeadlessConteneur'],
      customLaunchers: { ChromeHeadlessConteneur: { base: 'ChromeHeadless', flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] } },
      singleRun: true, autoWatch: false,
      coverageReporter: { dir: '/workspace/analyse/angular-couverture', subdir: '.', reporters: [{ type: 'cobertura', file: 'cobertura.xml' }] },
    });
  };
  ```

  `CHROME_BIN=/opt/analyse/chromium-conteneur` (le lanceur du plan) fonctionne. Il ne faut pas ajouter
  `--headless` : `ChromeHeadless` le passe déjà.
- **E6 (Tasks 2 et 4, npm audit en erreur).** Hors réseau (ou sans `package-lock.json`), `npm audit --json`
  renvoie 1 et un JSON non vide, `{ "message", "error" }`, sans `vulnerabilities`. Le script du plan
  (`[ -s npm-audit.json ] && code audit_npm 0`) l'enregistre comme réussi. Le lecteur du plan
  (`j.vulnerabilities ?? {}`) en tire alors **zéro constat** : faux négatif, alors que la spec veut un no-go quand
  la mesure manque. Correction proposée :
  - dans `lireNpmAudit`, renvoyer `null` si `vulnerabilities` n'est pas un objet, ou si `error` est présent ;
  - dans le script, tenir compte de la même règle, ou laisser le lecteur décider.
- **E7 (Task 4, dotnet vulnérables).** `frameworks` et `transitivePackages` peuvent être **absents** ; les
  `?? []` du plan le gèrent déjà. Le code de retour vaut 0 même avec des vulnérabilités. Hors réseau, la sortie
  n'est pas du JSON (`error: Unable to load the service index…`), donc le lecteur renvoie `null` : c'est correct.
  Le cache HTTP NuGet sous `HOME` peut répondre hors ligne ; ce n'est pas un problème.
- **E8 (Task 2, gitleaks et base invalide).** Avec une base inexistante, `gitleaks git --log-opts="<base>..HEAD"`
  journalise `ERR [git] fatal: ambiguous argument`, mais renvoie **0** et écrit `[]` : faux négatif. Le script
  doit vérifier la base, par exemple `git cat-file -e "$BASE^{commit}" || exit 3`, avant tout le reste (la
  vérification hexadécimale du plan ne suffit pas). `git diff` renvoie 128 dans ce cas. Ajouter aussi
  `--no-banner --no-color` pour des journaux lisibles.
- **E9 (Task 2, gitleaks contournable depuis le dépôt).** Trois mécanismes du dépôt analysé, contrôlés par
  l'implémenteur, suppriment une fuite avec la commande du plan : un commentaire `gitleaks:allow` sur la ligne, un
  `.gitleaks.toml` avec `[allowlist] paths`, et un `.gitleaksignore` contenant l'empreinte. `-i/--gitleaks-ignore-path`
  ne neutralise pas le `.gitleaksignore` du dossier analysé. Commande vérifiée, qui détecte la fuite malgré les
  trois :

  ```bash
  git clone -q --no-checkout /workspace/projet /tmp/gitleaks-source   # aucun fichier de travail : ni .gitleaks.toml ni .gitleaksignore
  printf '[extend]\nuseDefault = true\n' > /tmp/gitleaks.toml          # ou un fichier figé dans /opt/analyse
  gitleaks git /tmp/gitleaks-source --no-banner --no-color --config /tmp/gitleaks.toml --ignore-gitleaks-allow \
    --log-opts="$BASE..HEAD" --report-format json --report-path "$SORTIE/gitleaks.json" --exit-code 0
  ```

  Ajouter aussi `--redact` : `Secret` et `Match` valent alors `"REDACTED"`, et aucune valeur de secret n'atteint
  `/workspace/analyse`. Vérifié.
- **E10 (Task 2, Semgrep contournable depuis le dépôt).** Un commentaire `// nosemgrep` en fin de ligne masque
  le résultat. Il faut ajouter **`--disable-nosem`** (vérifié : 0 résultat sans l'option, 1 avec). Un
  `.semgrepignore` (`src/`) ne masque pas les fichiers passés explicitement en argument (vérifié).
- **E11 (Task 5, signes de triche).** Proposition : ajouter `.gitleaks.toml`, `.gitleaksignore` et
  `.semgrepignore`, ainsi que les lignes ajoutées contenant `gitleaks:allow` ou `nosemgrep`, aux signes de triche.
  Hors plan actuel ; à décider.
- **E12 (Task 3, chemins Cobertura Angular).** Les `filename` istanbul sont relatifs au `<source>`, qui est le
  dossier du projet Angular, sans `/` final. Le plan retire le préfixe `<source>` d'un `filename` qui le
  contiendrait. Pour Angular, il faut au contraire **joindre** `<source>` et `filename`, puis retirer
  `/workspace/projet/`. Sinon, un projet Angular dans un sous-dossier (`front/`) donne `src/app/x.ts` au lieu de
  `front/src/app/x.ts`, et aucune ligne modifiée n'est trouvée. Règle sûre :
  - si `filename` est absolu, le garder ;
  - sinon, le préfixer par le premier `<source>` (avec `/` ajouté) ;
  - puis retirer `/workspace/projet/`.
  Le BOM du Cobertura .NET ne gêne pas les expressions du plan. L'ordre `number` puis `hits` est confirmé pour
  les deux formats.
- **E13 (Task 3, couverture et projets de test).** `dotnet-coverage` instrumente aussi les assemblies de test.
  Les lignes modifiées dans les fichiers de test sont donc comptées, et presque toujours couvertes, ce qui gonfle
  le pourcentage. Options : exclure les fichiers de test dans `couvertureLignesModifiees`, ou passer à
  `dotnet-coverage` un fichier de réglages qui exclut les modules `*Tests*`. À décider.
- **E14 (Task 4, Semgrep).** `check_id` porte le préfixe `opt.analyse.` (chemin du fichier de règles). Le message
  du plan (`${check_id} : ${message}`) reste lisible mais long. Suggestion : retirer le préfixe `opt.analyse.`.
  Les sévérités ERROR, WARNING et INFO sont confirmées dans `extra.severity`.
- **E15 (Task 2, Semgrep, code de retour).** 0 avec ou sans résultat, donc `semgrep.code = 0` signifie « a
  tourné ». Il faut **ne pas** ajouter `--error`. Un fichier cible inexistant donne 2 ; le plan ne passe que des
  fichiers existants (`--diff-filter=d`).
- **E16 (Task 9, faux secret).** gitleaks ignore les fausses clés à faible entropie : `AKIAFAUXFAUXFAUXFAUX` et
  `AKIAAAAAAAAAAAAAAAAA` ne sont **pas** détectées. `AKIAQ3EGRT7NMZ5WXPLA` et `AKIAZ7FAUX2CLE3TEST4` le sont
  (règle `aws-access-token`, aussi dans `"aws_secret_access_key": "…"` d'un JSON). Les 16 caractères doivent être
  dans `[A-Z2-7]` et variés.
- **E17 (Task 2, Angular avec Vitest).** Depuis Angular 21, `ng new` choisit **Vitest** par défaut
  (`@angular/build:unit-test` sans `runner`). `ng test --coverage` y échoue (code 1) :
  `Code coverage requires either "@vitest/coverage-v8" or "@vitest/coverage-istanbul" to be installed`. Le
  lanceur Karma de l'image ne s'applique pas. Avec le plan actuel, ces projets donnent `tests_angular = echec`
  et une couverture absente, donc no-go. À trancher : accepter ce no-go en 2b, ou gérer Vitest plus tard.
- **E18 (Task 2, divers .NET).** `dotnet new` affiche « An issue was encountered verifying workloads » avec une
  racine en lecture seule ; c'est sans effet sur `restore`, `test` et `list`. Les modèles du SDK 9 ne proposent pas
  `-f net8.0` : sans incidence pour l'analyse, qui ne crée pas de projet. Un projet net8.0 se construit et se
  teste avec le SDK 9 et le runtime 8.0.33. La restauration affiche l'avertissement NuGet Audit `NU1903` pour un
  paquet vulnérable ; un projet en `TreatWarningsAsErrors` échouerait donc à la compilation.
- **E19 (Tasks 1 et 2, règles Semgrep récupérées à la construction).** Le plan prévoyait un fichier
  `conteneur/analyse/semgrep-regles.yml` produit par la Task 1, versionné et copié dans l'image. L'utilisateur a
  décidé de ne pas le versionner : la licence des règles n'est pas libre et le dépôt est public. Ce qui change :
  - le fichier est ignoré par git (`.gitignore`) ;
  - le Dockerfile télécharge p/csharp et p/typescript à la construction, les valide (§ 3) et les écrit dans
    `/opt/analyse/semgrep-regles.yml` ;
  - le `COPY` nomme les fichiers d'`analyse/` un à un, pour qu'une copie locale non versionnée n'entre jamais dans
    l'image.
  Conséquences :
  - les règles ne sont plus figées par un SHA-256, mais seulement par le digest de l'image ;
  - deux constructions successives peuvent embarquer des règles différentes ;
  - la construction exige l'accès à semgrep.dev et échoue sans lui.
- **E20 (Task 2, gitleaks lit le `.gitleaksignore` du dossier courant).** En plus de celui du dossier analysé,
  gitleaks charge le `.gitleaksignore` du **répertoire courant** (constaté en Task 2). Lancé depuis
  `/workspace/projet`, il lirait donc le fichier du dépôt même en analysant un clone `--no-checkout` (E9).
  `mesurer.sh` (E21) lance donc gitleaks depuis `$HOME` (`/tmp/mesures-home`, vidé au début de chaque mesure et
  qui ne contient pas de `.gitleaksignore`) : `( cd "$HOME" && gitleaks git "$CLONE" … )`. Dans le test E9 du spike, gitleaks avait été
  lancé depuis `/tmp`, ce qui explique que l'effet n'avait pas été vu.
- **E21 (Tasks 2 et 9, analyse en deux conteneurs).** Dans un seul conteneur, le code testé (`dotnet test`,
  `ng test`, `karma.conf.js` ou MSBuild du dépôt) tourne sous le même uid que Semgrep, gitleaks, le diff et les
  audits. Un processus laissé en arrière-plan pourrait alors réécrire leurs résultats ou préparer `$HOME`.
  `analyser.sh` est donc remplacé par deux scripts, que la Task 9 lance dans deux conteneurs successifs :
  - `/opt/analyse/mesurer.sh COMMIT_BASE`, lancé en premier, n'exécute **aucun** code du dépôt.
    - La copie est montée en lecture seule sur `/workspace`.
    - `HOME` et les caches sont sous `/tmp`.
    - Les résultats vont dans `/mesures`, un volume propre à l'orchestrateur, jamais monté dans le conteneur de
      tests. L'image crée `/mesures` et le donne à `node`.
    - Il produit `sha`, `diff.patch`, `fichiers-modifies`, `semgrep`, `gitleaks` et `audit_npm`. `npm audit` lit
      seulement `package-lock.json`, sans `npm ci` ni script.
  - `/opt/analyse/tester.sh` tourne ensuite dans la copie en écriture et produit `tests_dotnet`, `audit_dotnet`,
    `tests_angular` et les fichiers de couverture, dans `/workspace/analyse`. L'audit .NET reste dans ce conteneur,
    car la restauration NuGet évalue le MSBuild du dépôt.
  **Limite assumée :** le code testé peut falsifier les résultats de tests, la couverture et l'audit .NET. Les
  contre-mesures sont ailleurs : le QA relance les tests, le reviewer lit le code, et les signes de triche sont
  repérés. Semgrep, gitleaks, le diff et npm audit, eux, ne peuvent plus être falsifiés par ce code.
  Le test Docker « mesures hors de portée du code testé » le vérifie : un projet hostile tente de réécrire
  `/mesures/*` et `/workspace/analyse/semgrep.json`, et les empreintes de `/mesures` restent identiques.
  Mesures également protégées des configurations du dépôt :
  - `npm audit` impose `npm_config_registry=https://registry.npmjs.org/` et `npm_config_include=dev,optional,peer`
    par variables d'environnement. Il tourne dans un dossier vide de `/tmp`, où seuls `package.json` et
    `package-lock.json` sont copiés (fichiers ordinaires, pas de liens). Le `.npmrc` du dépôt est ainsi écarté : sans
    cette copie, `package-lock=false` (l'arbre est reconstruit depuis `package.json`) ou `workspace=x` (un seul
    espace de travail audité) changeaient l'arbre audité, ce que les variables d'environnement n'empêchent pas.
    Vérifié hors ligne : avec chacun de ces `.npmrc`, l'audit échoue toujours sur la requête
    `registry.npmjs.org/-/npm/v1/security/advisories/bulk` du verrou.
  - `fichiers-modifies` sépare les chemins par NUL (`git diff --name-only -z`). Semgrep les reçoit tels quels
    (`mapfile -d ''`). La recherche des cibles lit aussi `find -printf '%d %p\0'` par NUL. Les lectures git se font
    avec `GIT_NO_REPLACE_OBJECTS=1`.
  - `dotnet list package --vulnerable` reçoit `--source https://api.nuget.org/v3/index.json`.
  - Semgrep reçoit `--max-target-bytes 0` : il écartait les fichiers de plus de 1 Mo.
  Choix des cibles : la solution ou le projet .NET, et l'`angular.json`, sont pris au niveau le moins profond. S'il
  y en a plusieurs à ce niveau, l'outil vaut 3 (mesure manquante).
- **E22 (Task 2, liste blanche globale de gitleaks).** La configuration par défaut de gitleaks 8.30.1 contient un
  `[allowlist]` global dont les `paths` écartent notamment `gitleaks.toml`, `package-lock.json`, `yarn.lock`,
  `node_modules/`, `vendor/`, les images, les polices et les PDF. Un dépôt peut donc y cacher un secret : vérifié,
  `deploy/gitleaks.toml` n'est pas détecté avec `[extend] useDefault = true`.
  L'image télécharge `config/gitleaks.toml` de la version (SHA-256
  `e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf`) et retire seulement ces `paths` globaux.
  Elle garde les `regexes`, les `stopwords` et les listes blanches propres à chaque règle. Le résultat est écrit
  dans `/opt/analyse/gitleaks.toml`. La construction vérifie :
  - que le nombre de règles est inchangé ;
  - qu'il ne reste aucun `paths` global ;
  - que gitleaks charge le fichier.
  Contrepartie : davantage de faux positifs possibles dans les verrous et les fichiers binaires. Pour la Task 5, on
  peut aussi signaler les fichiers de ces chemins ajoutés par la branche.

## 7. Points ouverts

- **Licence des règles Semgrep.** Les règles du registre portent `license: Semgrep Rules License v1.0`
  (semgrep.dev/legal/rules-license), qui n'est pas une licence libre, et le dépôt GitHub du projet est
  **public**. **Décision de l'utilisateur :** les règles ne sont pas versionnées. Elles sont récupérées à chaque
  construction de l'image, puis figées par son digest (§ 3, E19). Il n'y a donc aucune redistribution dans le dépôt.
- **Taille de l'image** (2,53 Go contre 620 Mo). Le plan ajoute les outils à l'image des agents ; tous les
  conteneurs d'agents en héritent. Une image d'analyse séparée serait plus légère pour les agents, mais
  modifierait le plan.
- **Semgrep 1.183.0 a été publiée la veille** (2026-10-29). Par prudence, on peut préférer la dernière version
  publiée depuis au moins deux semaines.
- **Passerelle non testée.** Restauration NuGet / npm, `npm audit` et `dotnet list --vulnerable` ont été faits
  sur le réseau bridge. Le passage par le proxy authentifié de la passerelle (`HTTPS_PROXY=http://tache:<jeton>@passerelle:…`)
  reste à vérifier en Task 9. `npm audit` interroge `registry.npmjs.org` et `dotnet list --vulnerable`
  interroge `api.nuget.org`, tous deux dans la liste blanche.
