# Prompt pour Claude Design (archive)

La maquette est terminée : elle se trouve dans `maquette/bureau-des-agents.html`. Ce prompt est conservé pour pouvoir la refaire ou l'étendre. Les corrections faites ensuite (clé API hors des conteneurs, proxy de sortie, droit d'écriture du cadreur, notifications, journal) sont déjà intégrées dans la maquette.

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
