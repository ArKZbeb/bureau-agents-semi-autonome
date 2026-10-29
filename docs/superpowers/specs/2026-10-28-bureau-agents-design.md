# Bureau d'agents IA — Spec V1

Oct 28, 2026 · @Tristan

## Contexte et décisions clés

Un bureau virtuel en 2D, utilisé en solo et en local, où une équipe d'agents IA prend une user story d'un projet existant, la cadre avec moi, l'implémente, la contrôle et me la soumet pour validation. Rien ne touche mes repos sans mon accord explicite.

| Sujet | Décision |
| --- | --- |
| Usage | Solo, application locale ouverte dans le navigateur (`localhost`) |
| Bureau | Carte 2D vue de dessus, pixel art, avatar déplaçable au clavier |
| Exécution des agents | Claude Code headless dans un conteneur Docker éphémère par tâche, sur ma machine |
| Méthode | Skills superpowers : brainstorming, writing-plans, subagent-driven-development, TDD, verification-before-completion |
| Stacks des projets reliés | .NET (back) et Angular (front), tests sans vraie base de données |
| Fin de pipeline | Validation humaine obligatoire avant toute action sur le repo |
| Outils de création | Claude Code pour construire, Claude Design pour la maquette du bureau |

## Architecture

Trois briques locales : le bureau dans le navigateur, l’orchestrateur qui pilote tout, et un conteneur Docker éphémère par tâche où Claude Code s’exécute.

```mermaid
flowchart LR
  subgraph M["Ma machine (localhost)"]
    B["Bureau (navigateur)<br/>Angular + carte Phaser"] <--> O["Orchestrateur<br/>TypeScript / Node<br/>SQLite : tâches, rapports"]
    O -->|pilote| C["Conteneur par tâche<br/>Claude Code + superpowers<br/>Hook gardien PreToolUse<br/>Branche dédiée<br/>Aucun secret"]
    P["Projets reliés<br/>.NET / Angular"] <-->|clone| C
  end
  C -->|proxy à liste blanche| N["Proxy API, nuget.org, registre npm<br/>Tout le reste est bloqué"]
```

L’orchestrateur clone le projet dans le conteneur et ne récupère la branche dans le repo qu’après ma validation.

## Parcours d’une user story

Une story passe par sept étapes et deux boucles de correction avant d’arriver sur mon bureau.

```mermaid
flowchart LR
  A[Cadrage] --> B["Patron (plan)"]
  B -->|objections, 2 échanges max| A
  B --> C[Implémentation]
  C --> D[Review]
  D --> E["Patron (code)"]
  E --> F[QA]
  F -->|no-go, 3 essais max| C
  F -->|go| G[Ma validation]
  G --> H["Branche ou PR<br/>(ou renvoi, abandon)"]
```

Si le patron et le cadreur restent en désaccord après deux échanges, je tranche ; après trois no-go, la tâche me revient avec un résumé du blocage. Depuis mon bureau, « renvoyer avec commentaire » relance l’implémentation.

## Le bureau

La carte rend le travail des agents visible sans jamais me ralentir : chaque action est aussi accessible par un panneau latéral et une mini-carte cliquable qui téléporte dans une salle.

| Salle | Ce qu'on y voit | Ce que j'y fais |
| --- | --- | --- |
| Hall d'entrée | Tableau des projets reliés, kanban des tâches par étape | Relier un projet (dossier local), créer une user story |
| Salle de cadrage | Agent à une table, tableau blanc où se construisent spec et plan | Discuter avec le cadreur, joindre une maquette Claude Design |
| Bureau du patron | Remises en question et approches alternatives | Trancher en cas de désaccord sur le plan |
| Open space | Un poste par tâche en cours, écran avec activité en direct | Suivre l'implémentation |
| Salle de review | Rapport en construction : couverture, qualité, failles | Consulter |
| Labo QA | Vérification de chaque critère d'acceptation | Consulter le verdict |
| Poste de sécurité | Journal des commandes qui défile, alarme en cas de blocage | Autoriser ou refuser une commande escaladée |
| Mon bureau | Boîte de validation : diff, rapports, avis du patron, journal | Récupérer la branche, ouvrir une PR, renvoyer, abandonner |

Interactions :

- S'approcher d'un agent puis appuyer sur `E` (ou cliquer) ouvre un panneau à droite : discussion, activité en direct, documents de la tâche.
- Une icône au-dessus de chaque agent indique son état : réfléchit, travaille, m'attend (« ! »), bloqué.
- Quand un agent m'attend : notification, icône « ! » et repère sur la mini-carte. C'est le seul moment où ma présence est requise.

## Les agents

Chaque agent démarre avec un contexte vierge et ne reçoit que des documents (spec, plan, diff, rapports). Le reviewer, le QA et le patron ne voient jamais le raisonnement de l'implémenteur, ce qui garantit des avis indépendants.

| Agent | Entrées | Sorties | Skills / outils | Écriture | Modèle par défaut |
| --- | --- | --- | --- | --- | --- |
| Cadreur | Repo (lecture), ma demande, maquette éventuelle | `spec.md` avec critères d'acceptation numérotés, `plan.md` | brainstorming, writing-plans | Spec et plan uniquement | Opus |
| Patron (plan) | Spec, plan | Note : pour chaque choix, pourquoi, 2 alternatives, risques | — | Non | Opus |
| Implémenteur | Plan, spec, retours éventuels | Commits sur `task/<id>`, résumé | subagent-driven-development, test-driven-development, verification-before-completion | Oui | Sonnet |
| Reviewer | Diff, spec | Rapport : couverture du code modifié, qualité, failles, signes de triche | Coverlet, `ng test --code-coverage`, ReportGenerator, Semgrep, `dotnet list package --vulnerable`, `npm audit`, gitleaks, Roslyn, ESLint | Non | Sonnet |
| Patron (code) | Diff, rapports | Note critique non bloquante | — | Non | Opus |
| QA | Spec, rapports, note du patron, suite de tests | Verdict go / no-go avec une preuve par critère | Exécution des tests | Non | Opus |
| Gardien | Chaque commande, tâche, plan | Autoriser / refuser / me demander | Hook `PreToolUse` | Non | Haiku |

Règles :

- Le droit d'écriture est imposé par les permissions de Claude Code (outils `Edit` et `Write` retirés aux agents en lecture seule), pas seulement par le prompt.
- Le patron peut bloquer sur le plan, deux échanges maximum ; s'il n'y a pas d'accord, je tranche. Sur le code, il ne fait que donner son avis.
- Le reviewer mesure la couverture du code ajouté ou modifié, pas celle du projet entier. Il signale tout test désactivé, assertion supprimée ou seuil abaissé.
- Le verdict QA combine des règles automatiques appliquées par l'orchestrateur et le jugement de l'agent. No-go automatique si : un test échoue, une faille critique ou haute est détectée, la couverture du nouveau code est sous 80 %, un critère n'est pas rempli, ou un outil d'analyse n'a pas pu tourner. Seuils configurables par projet.
- Un no-go renvoie la tâche à l'implémenteur avec le dossier complet, trois fois maximum ; au-delà, la tâche me revient avec un résumé du blocage.
- Les modèles sont configurables par agent.

## Le gardien des commandes

La vraie garantie de sécurité est le conteneur ; le gardien empêche les erreurs, alerte et trace tout. En cas de doute, de panne ou de délai dépassé, il bloque.

1. **Environnement du conteneur.** Aucune sortie réseau directe ; seule sortie via un proxy à liste blanche : proxy API de l'orchestrateur, nuget.org, registre npm. Aucun secret : ni clé API (ajoutée par le proxy), ni clés SSH, ni identifiants Git. L'agent ne peut pas pousser ; c'est l'orchestrateur, hors conteneur, qui récupère la branche après ma validation.
2. **Règles déterministes (hook `PreToolUse`).**
   - Autorisées directement, dans le dossier du projet : `dotnet build`, `dotnet test`, `ng test`, `npm ci`, `git status`, `git diff`, `git commit`, lecture et écriture de fichiers du repo.
   - Bloquées sans discussion : suppression hors du projet, téléchargement suivi d'exécution (`curl … | sh` et équivalents), `sudo`, `chmod 777`, accès au socket Docker, lecture des variables d'environnement ou de fichiers de secrets, modification de la configuration Claude Code ou des hooks, `git push`, `git config`.
   - Tout le reste passe en couche 3.
3. **Avis de l'agent gardien (Haiku).** Répond autoriser, refuser ou me demander, en tenant compte de la tâche et du plan. Il lit le contenu de tout script créé pendant la tâche avant de le laisser exécuter. Pour toute nouvelle dépendance NuGet ou npm, il vérifie existence, notoriété, typosquatting et vulnérabilités connues. Une escalade met la tâche en pause jusqu'à ma décision.
4. **Audit final.** Chaque commande est journalisée : commande, décision, décideur, raison, extrait de sortie. Le journal et un résumé des points sensibles (nouvelles dépendances, refus, escalades) vont au QA et dans mon bureau de validation.

Le gardien est la partie la plus testée de l'outil : une liste de commandes dangereuses, variantes déguisées comprises (encodage base64, script intermédiaire, alias), et une liste de commandes légitimes qui doivent passer.

## Guardrails IA

Chaque garde-fou est appliqué hors de portée de l'agent (conteneur, proxy, orchestrateur), jamais seulement par son prompt. Objectif : un agent trompé par une injection ne peut rien casser, rien exfiltrer, ni tricher sur sa propre évaluation.

| Risque | Garde-fou | Appliqué par |
| --- | --- | --- |
| Injection de prompt via le repo (commentaire, README, sortie de test, doc d'une dépendance) | Le contenu du repo est déclaré comme donnée dans chaque prompt système ; chaque commande est jugée par rapport au plan validé, jamais aux instructions trouvées ; tout écart au plan passe en couche 3 | Prompts + gardien |
| Agent qui désactive ses garde-fous | Configuration dans `/etc/claude-code/managed-settings.json`, monté en lecture seule (priorité maximale, non surchargeable) ; `allowManagedPermissionRulesOnly` ; `disableBypassPermissionsMode` ; hooks hors du dossier inscriptible | Conteneur |
| Contournement des règles de fichiers par le shell | Les règles `deny` sur Read et Edit ne bloquent que les outils intégrés, pas `cat .env` : Bash est filtré par le hook, l'accès disque est limité par le conteneur | Hook + conteneur |
| Vol de la clé API | La clé n'entre jamais dans le conteneur : il appelle un proxy de l'orchestrateur (`ANTHROPIC_BASE_URL`) qui ajoute la clé | Proxy API |
| Exfiltration | Réseau Docker interne sans sortie directe ; sortie uniquement via un proxy HTTP à liste blanche (proxy API, nuget, npm) | Docker + proxy |
| Évasion ou abus du système | Utilisateur non root, `--cap-drop=ALL`, `--security-opt no-new-privileges`, racine en lecture seule sauf workspace et `/tmp`, pas de socket Docker, limites `--memory`, `--cpus`, `--pids-limit` | Orchestrateur |
| Falsification du journal | Le hook transmet chaque décision à l'orchestrateur, qui écrit le journal hors du conteneur | Orchestrateur |
| Triche sur l'évaluation | Seuils et configuration de couverture montés en lecture seule ; reviewer et QA dans un conteneur neuf, branche en lecture seule ; le QA relance lui-même les tests ; toute modification de fichier de test est signalée | Orchestrateur |
| Dérive hors périmètre | Le plan liste les zones touchées ; toute modification non prévue de CI, Dockerfile, configuration d'authentification ou `.claude/` → me demander | Hook |
| Chaîne d'approvisionnement | `npm ci` et `dotnet restore` sur lockfile ; scripts d'installation npm désactivés par défaut (`--ignore-scripts`), exceptions par projet ; nouvelle dépendance → couche 3 avec vérification de licence | Hook + gardien |
| Emballement des coûts | Plafond appliqué par le proxy API (coupure au budget), `--max-turns` par agent, durée max par étape | Proxy + orchestrateur |
| Perte de contrôle | Bouton d'arrêt global : stoppe tous les conteneurs et met les tâches en pause | Bureau |

Escalade en mode headless : sans humain pour répondre à un « ask », le hook refuse avec la raison « en attente de validation », l'orchestrateur met la tâche en pause, puis reprend la session après mon accord avec une autorisation à usage unique pour cette commande exacte. Une décision `defer` existe pour ce cas mais n'est pas encore documentée officiellement : à vérifier par un spike en phase 1.

Tests des guardrails : un repo piège contenant des injections (README, commentaires, sorties de test) et un scénario qui vérifie qu'aucune commande interdite n'a tourné, qu'aucun accès hors liste blanche n'a eu lieu, que la clé API est absente du conteneur et que le journal est complet. Il tourne avec des agents simulés à chaque build, et avec de vrais agents de temps en temps.

Sources : [référence des hooks Claude Code](https://code.claude.com/docs/en/hooks?frame=0), [permissions et managed settings](https://claudefa.st/blog/guide/development/permission-management), [limites des règles deny face au shell](https://docs.nvidia.com/ai-workbench/user-guide/latest/quickstart/quickstart-claude-sandbox.html), [décision defer](https://github.com/anthropics/claude-code/issues/41791).

## Contrôle d'intégrité

Un agent IA ne peut pas prouver qu'un fichier n'a pas été modifié ; une empreinte cryptographique, si. Le contrôle d'intégrité combine donc des vérifications déterministes, qui détectent toute altération, et un agent contrôleur, qui détecte les manipulations de sens qu'aucune empreinte ne voit. Toute anomalie met la tâche en pause et déclenche une alerte au poste de sécurité ; rien ne reprend sans moi.

| Ce qui pourrait être altéré | Vérification | Par |
| --- | --- | --- |
| Spec, plan, critères d'acceptation après ma validation | Empreinte SHA-256 enregistrée et signée (HMAC, clé détenue par l'orchestrateur seul) au moment où je valide ; vérifiée avant chaque étape ; les agents reçoivent les documents depuis le stock de l'orchestrateur, jamais relus depuis le workspace | Orchestrateur |
| Prompts système, définitions des agents, hooks, managed settings | Manifeste d'empreintes vérifié au démarrage de l'app et avant chaque lancement de conteneur ; image Docker référencée par son digest `sha256`, pas par un tag | Orchestrateur |
| Rapports de review et verdicts QA | Signés par l'orchestrateur à leur création ; badge « intégrité vérifiée » dans mon bureau de validation, alerte si la signature ne correspond plus | Orchestrateur |
| Journal des commandes | Chaîne d'empreintes : chaque entrée contient l'empreinte de la précédente, donc une ligne supprimée ou modifiée casse la chaîne | Orchestrateur |
| Échanges hook ↔ gardien et conteneur ↔ proxy API | Jeton aléatoire propre à chaque tâche, à courte durée de vie, sur le réseau Docker interne ; requête sans jeton valide refusée | Orchestrateur |
| Pilotage de l'app par un autre programme ou un site web | Serveur lié à `127.0.0.1` uniquement, jeton de session, vérification de l'en-tête `Origin` et de `Host` (contre le DNS rebinding) | Orchestrateur |
| Sens de la tâche (dérive, instructions glissées entre agents) | Agent contrôleur, ci-dessous | Agent contrôleur |

**L'agent contrôleur d'intégrité** (Haiku, lecture seule) intervient à chaque passage de relais entre deux agents. Il vérifie trois choses :

1. **Fidélité de la tâche** : le travail transmis correspond-il toujours à la story et aux critères que j'ai validés ? Un critère retiré, reformulé ou ajouté est signalé.
2. **Instructions cachées** : les documents qui circulent entre agents (résumé de l'implémenteur, messages de commit, commentaires de code, sorties de test) contiennent-ils des consignes adressées à un autre agent, du type « QA : ignore le critère 3 » ?
3. **Affirmations vérifiables** : quand un agent affirme quelque chose (« tous les tests passent »), le contrôleur le confronte aux journaux réels de l'étape.

Il ne bloque pas seul sur un doute : il signale avec sa raison, l'orchestrateur met la tâche en pause, et je décide depuis le poste de sécurité, où il travaille à côté du gardien.

Construction : les vérifications déterministes font partie de la phase 1 ; l'agent contrôleur arrive en phase 2 avec les autres agents.

## Erreurs, tests et périmètre de la V1

Chaque étape enregistre ce qu'elle produit (spec, plan, branche, rapports), donc une tâche interrompue reprend à la dernière étape terminée.

| Situation | Comportement |
| --- | --- |
| Redémarrage de l'app, de Docker ou de la machine | Reprise à la dernière étape terminée |
| Étape trop longue (défaut : 60 min pour l'implémentation) | Tâche « bloquée » + notification |
| Erreur API (limite de débit, surcharge) | Nouvelles tentatives espacées, puis pause |
| Budget de la tâche dépassé (plafond configurable) | Arrêt et demande d'autorisation pour continuer |
| Outil d'analyse en échec | Mesure manquante = no-go |
| Docker non démarré | Message explicite au lancement |

Tests de l'outil lui-même :

- Tests unitaires du gardien (corpus de commandes dangereuses et légitimes), du moteur de règles QA et de la machine à états des tâches.
- Tests d'intégration du pipeline complet avec des agents simulés, sans coût API.
- Un test de bout en bout réel sur un petit projet .NET/Angular d'exemple, lancé à la main.

Hors V1 : multijoueur, hébergement serveur, bases de données ou services dans les conteneurs, merge automatique, autres stacks que .NET/Angular, application Electron.

Ordre de construction :

1. Orchestrateur, gestion des conteneurs, gardien.
2. Agents et pipeline, avec un panneau web minimal.
3. Bureau de validation (diff, rapports, actions).
4. Carte Phaser, une fois la maquette Claude Design validée.

## Prompt pour Claude Code

À utiliser dans un repo vide, avec le plugin superpowers installé. Exporte d'abord ce document en Markdown et place-le dans `docs/superpowers/specs/2026-10-28-bureau-agents-design.md`.

```markdown
Tu construis « Bureau d'agents », une application locale décrite dans la spec
docs/superpowers/specs/2026-10-28-bureau-agents-design.md. Lis-la entièrement avant toute chose,
en particulier les sections « Le gardien des commandes » et « Guardrails IA ».
La conception est déjà validée : ne relance pas de brainstorming sur l'architecture.
Si un point de la spec est ambigu ou contradictoire, pose-moi UNE question à la fois.

Étape 1 — Spikes
Avant de planifier, vérifie dans la documentation officielle de Claude Code (hooks, permissions,
managed settings, mode headless) et par de petits essais :
- comment un hook PreToolUse bloque, autorise ou met en attente une commande en mode headless
  (allow / deny / ask, et la décision defer si elle est disponible) ;
- comment reprendre une session après une décision humaine (--resume) ;
- que /etc/claude-code/managed-settings.json, monté en lecture seule, ne peut pas être surchargé.
Résume-moi les résultats et ce qu'ils changent au design.

Étape 2 — Plan
Utilise le skill writing-plans pour la PHASE 1 uniquement : orchestrateur, conteneurs Docker,
gardien et guardrails. Les phases 2 à 4 feront chacune l'objet d'un plan séparé.
Soumets-moi le plan et attends mon accord.

Étape 3 — Implémentation (après mon accord)
Utilise subagent-driven-development et test-driven-development. Termine par
verification-before-completion.

Stack : orchestrateur TypeScript / Node (LTS), Claude Agent SDK, SQLite, dockerode.
Front Angular (LTS). Aucun code de carte Phaser avant la phase 4.
Maquette de référence : maquette/bureau-des-agents.html (export Claude Design). Reprends
ses écrans, textes, états et données d'exemple pour les tests et le front ; ne reprends pas
son code, qui n'est qu'un prototype.

Guardrails — règle d'or : tout garde-fou est appliqué hors de portée de l'agent.
Une consigne dans un prompt n'est jamais une protection suffisante.

Conteneur (un par tâche, éphémère) :
- Claude Code tourne DANS le conteneur, jamais sur l'hôte.
- Utilisateur non root, --cap-drop=ALL, --security-opt no-new-privileges, racine en lecture
  seule sauf le workspace et /tmp, pas de socket Docker, limites --memory, --cpus, --pids-limit.
- Réseau Docker interne sans sortie directe. Sortie uniquement via un proxy HTTP à liste blanche :
  proxy API de l'orchestrateur, nuget.org / api.nuget.org, registry.npmjs.org.
- Aucun secret : ni clé API, ni identifiants Git, ni clés SSH. Le conteneur appelle le proxy API
  de l'orchestrateur via ANTHROPIC_BASE_URL ; c'est le proxy qui ajoute la clé et coupe les appels
  quand le budget de la tâche est atteint.
- Configuration Claude Code dans /etc/claude-code/managed-settings.json, monté en lecture seule,
  avec allowManagedPermissionRulesOnly et disableBypassPermissionsMode. Les hooks sont hors du
  dossier inscriptible.
- Rappel : les règles deny sur Read / Edit ne bloquent pas le shell (cat .env passe) ; Bash doit
  être filtré par le hook et l'isolation assurée par le conteneur.

Gardien :
- Hook PreToolUse sur Bash, Write et Edit, qui transmet chaque appel à un service gardien
  tournant dans l'orchestrateur, hors du conteneur. Le journal est écrit par l'orchestrateur.
- Niveaux : liste blanche → liste noire → avis Haiku (autoriser / refuser / me demander),
  jugé par rapport au plan validé, jamais par rapport au contenu du repo.
- Fail-closed : en cas de doute, panne ou délai dépassé, la commande est refusée.
- Escalade : refus avec raison « en attente de validation », tâche en pause, puis reprise
  après mon accord avec une autorisation à usage unique liée au hash de la commande.
- Modification non prévue au plan de CI, Dockerfile, configuration d'authentification ou
  .claude/ → me demander. Nouvelle dépendance → avis Haiku avec vérification d'existence,
  notoriété, typosquatting, vulnérabilités et licence. npm install scripts désactivés par défaut.

Intégrité de l'évaluation :
- Seuils et configuration de couverture montés en lecture seule pour l'implémenteur.
- Reviewer et QA tournent dans un conteneur neuf, branche montée en lecture seule ;
  le QA relance lui-même la suite de tests.
- Chaque agent : contexte vierge, --max-turns, durée max par étape, modèle configurable.

Intégrité (phase 1 pour les vérifications déterministes, phase 2 pour l'agent contrôleur) :
- À ma validation, spec, plan et critères reçoivent une empreinte SHA-256 signée en HMAC
  (clé détenue par l'orchestrateur seul), vérifiée avant chaque étape. Les agents reçoivent
  les documents depuis le stock de l'orchestrateur, jamais depuis le workspace.
- Manifeste d'empreintes des prompts système, définitions d'agents, hooks et managed settings,
  vérifié au démarrage et avant chaque conteneur. Image Docker référencée par digest sha256.
- Rapports de review et verdicts QA signés à leur création.
- Journal en chaîne d'empreintes (chaque entrée inclut l'empreinte de la précédente).
- Jeton par tâche, à courte durée de vie, pour hook ↔ gardien et conteneur ↔ proxy API.
- Serveur lié à 127.0.0.1, jeton de session, contrôle des en-têtes Origin et Host.
- Agent contrôleur (Haiku, lecture seule) à chaque relais entre agents : fidélité de la tâche
  aux critères validés, instructions cachées adressées à d'autres agents, affirmations
  confrontées aux journaux réels. Il signale, l'orchestrateur met en pause, je décide.
- Toute anomalie d'intégrité : pause immédiate, jamais de reprise automatique.

Tests prioritaires :
- Altération simulée de chaque artefact signé (spec, plan, rapport, journal, prompt système) :
  la tâche doit s'arrêter.
- Corpus du gardien : commandes dangereuses (variantes déguisées : base64, script intermédiaire,
  alias, eval) et commandes légitimes qui doivent passer.
- Repo piège avec injections de prompt (README, commentaires, sorties de test) : vérifier
  qu'aucune commande interdite n'a tourné, aucun accès hors liste blanche, aucune clé dans
  le conteneur, journal complet.
- Machine à états des tâches et reprise après redémarrage.
- Agents simulés dans la suite automatique : aucun appel API réel.

Ne fais pas : multijoueur, déploiement serveur, docker compose, merge automatique, Electron.
Principe : YAGNI. Ne construis que ce que la phase en cours exige.
```

## Prompt pour la maquette Claude Design

À coller dans le projet Claude Design existant : ce prompt complète la première maquette (carte, panneau du cadreur, validation, alerte) avec tous les écrans et états prévus par la spec.

```markdown
Complète la maquette « Bureau d'agents » pour couvrir TOUTE l'application.
Garde exactement le style existant (pixel art, tuiles 32 px), les deux directions A / B,
le thème clair / sombre, l'interface en français et les données d'exemple déjà en place
(projets Film, Conducteur, Addiff ; tâches T-41, T-43, T-45). Invente des données réalistes
et cohérentes entre les écrans. Tous les éléments restent des créations originales.
Ajoute un index des écrans pour naviguer dans le prototype.

Rappel du produit : un développeur seul supervise des agents IA qui traitent des user stories
sur ses projets .NET / Angular. Parcours : Cadrage → Patron (plan) → Implémentation → Review →
Patron (code) → QA → Ma validation. Chaque tâche tourne dans un conteneur Docker ; un gardien
filtre chaque commande.

1. Hall d'entrée
- Le tableau mural devient un vrai kanban cliquable : une colonne par étape, une carte par tâche
  (projet, T-id, titre, agent en cours, essai n/3, budget consommé / plafond).
- Boutons « Relier un projet » et « Nouvelle user story ».
- Écran « Relier un projet » : choix d'un dossier local, stack détectée (.NET, Angular),
  devcontainer trouvé ou non, réglages du projet (seuil de couverture, budget par tâche,
  durée max par étape).
- Écran « Nouvelle user story » : projet, titre, description libre → envoi au cadreur.

2. Panneau d'agent (commun à tous les agents, onglets Discussion / Activité en direct / Documents)
- Activité en direct : flux des actions (fichiers modifiés, commandes avec badge du gardien
  autorisée / bloquée / escaladée, tests rouges puis verts).
- Documents : spec.md et plan.md rendus, maquette jointe en vignette.

3. Bureau du patron
- Revue du plan : pour chaque choix, le « pourquoi », deux alternatives, les risques.
- Désaccord après 2 échanges : écran d'arbitrage avec les deux positions côte à côte et
  les boutons « Garder l'approche du cadreur » / « Adopter l'alternative ».
- Note sur le code : remarques non bloquantes.

4. Open space : panneau de l'implémenteur avec la checklist du plan, l'étape TDD en cours,
   « essai 2/3 », jauge de budget. Montre un poste en échec (icône rouge) et sa raison.

5. Salle de review : rapport en construction, chaque outil avec son état (en cours, terminé,
   en échec) : Coverlet, ng test, Semgrep, npm audit, dotnet list package --vulnerable, gitleaks.

6. Labo QA
- Verdict GO : chaque critère d'acceptation coché avec sa preuve.
- Verdict NO-GO : règles automatiques déclenchées (ex. couverture des lignes modifiées 72 %
  < 80 %), renvoi à l'implémentation « essai 2/3 ».

7. Poste de sécurité
- Journal complet en tableau : heure, tâche, commande, couche (2 ou 3), décision, décideur,
  raison ; filtres par tâche et par décision.
- Garde l'écran d'alerte existant (csv-parsr).

8. Mon bureau (validation)
- Complète les onglets QA, Avis du patron et Journal des commandes.
- Règle de couverture : seuil bloquant sur les LIGNES modifiées ; les branches sont
  affichées à titre indicatif, avec cette mention.
- Fenêtre « Renvoyer avec commentaire ».
- Variante « tâche bloquée » : 3 no-go atteints, résumé de ce qui bloque, actions possibles.

9. États et alertes
- Budget dépassé : la tâche s'arrête et demande « Continuer (+ X $) / Abandonner ».
- Étape trop longue : tâche « bloquée » avec notification.
- Erreur API : tâche en pause, nouvelle tentative automatique.
- Démarrage sans Docker : écran explicatif.
- Premier lancement : bureau vide, invitation à relier un premier projet.

10. Conteneurs et réglages
- Liste des conteneurs en cours (tâche, durée, mémoire) avec un bouton « Arrêter ».
- Réglages : modèle par agent (Opus, Sonnet, Haiku), seuils par défaut, liste des domaines
  réseau autorisés (lecture seule), clé API masquée.

11. Intégrité
- Agent contrôleur d'intégrité au poste de sécurité, à côté du gardien.
- Alerte d'intégrité : artefact concerné (ex. plan.md modifié après validation), diff entre
  la version validée et la version trouvée, boutons « Restaurer la version validée » /
  « Abandonner la tâche ».
- Badge « intégrité vérifiée » dans l'en-tête de la boîte de validation.

Commence par l'index des écrans, puis le hall (point 1), et attends mon retour avant la suite.
```
