# Bureau d'agents — instructions pour Claude Code

> **Pour l'humain :** ouvre Claude Code à la racine de ce dossier, installe le plugin superpowers,
> puis écris simplement : « Lis README.md et suis les instructions. »
> La maquette s'ouvre dans un navigateur (`maquette/bureau-des-agents.html`, menu « Écrans ») ;
> elle charge React depuis unpkg, il faut donc une connexion internet.

---

## Instructions pour Claude Code

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

## Où trouver quoi

| Fichier | Rôle |
| --- | --- |
| `CLAUDE.md` | Règles permanentes du projet (à respecter à chaque session) |
| `docs/superpowers/specs/2026-10-28-bureau-agents-design.md` | Spec complète et validée |
| `maquette/bureau-des-agents.html` | Maquette de référence : écrans, textes, états, données d'exemple |
| `maquette/PROMPT-claude-design.md` | Prompt ayant servi à produire la maquette (archive) |
