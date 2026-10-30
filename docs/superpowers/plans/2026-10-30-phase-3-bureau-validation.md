# Phase 3 — Bureau de validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trancher depuis le panneau la fin de chaque tâche : examiner diff, rapports, avis du patron et journal, puis récupérer la branche dans mon dépôt, ouvrir une PR, renvoyer avec commentaire ou abandonner ; reprendre une tâche bloquée (relancer, relancer avec commentaire, reprendre le cadrage) ; traiter une alerte d'intégrité.

**Architecture:** L'orchestrateur lit le diff et fabrique un *bundle* Git de la branche dans des conteneurs jetables durcis (volume en lecture seule, sans réseau). Il vérifie que la pointe de la branche est le commit signé dans l'analyse, puis importe le bundle dans mon dépôt avec `git` sur l'hôte (sans hooks, sans écraser de branche). La PR est poussée et ouverte sur l'hôte avec mon `git` et mon `gh`, seulement sur mon clic. La machine à états gagne un événement `relance` ; un nouveau document signé `retour_humain` porte mes commentaires jusqu'à l'agent concerné. Les volumes d'une tâche terminée ou abandonnée sont supprimés.

**Tech Stack:** Orchestrateur inchangé (Node 24, TypeScript 6.0.3 par type stripping, `node:test`, `node:sqlite`, dockerode 5.0.1, `node:child_process` `execFile`). Front Angular 21.2 existant (`web/`).

**Spec:** `docs/superpowers/specs/2026-10-28-bureau-agents-design.md` (« Parcours d'une user story », salle « Mon bureau », « Contrôle d'intégrité », « Erreurs, tests et périmètre »). Maquette : `maquette/bureau-des-agents.html` (écrans « Mon bureau · Boîte de validation », « Mon bureau · Tâche bloquée », « Poste de sécurité · Alerte d'intégrité » ; textes en annexe A).

## Global Constraints

- Rien ne touche mon dépôt sans mon clic : récupérer la branche, pousser et ouvrir une PR sont des actions humaines explicites, journalisées (décideur « Moi »).
- Seul l'orchestrateur, hors conteneur, écrit dans mon dépôt ; aucun conteneur ne monte mon dépôt en écriture ; aucun identifiant Git n'entre dans un conteneur.
- Une branche n'est récupérée que si sa pointe est exactement le `sha` de l'analyse signée (`lireAnalyse`) ; sinon refus et journal « Refusé ». La vérification est faite deux fois : pointe du volume avant le bundle, puis pointe importée dans mon dépôt.
- Import dans mon dépôt : `git -c core.hooksPath=/dev/null`, `fetch --no-tags` d'un bundle vérifié (`git bundle verify`), réf `refs/heads/<brancheTache(id)>` créée seulement si elle n'existe pas (ou existe déjà au même `sha` : action idempotente) ; jamais de `--force`, jamais de checkout, jamais de modification de la branche courante.
- Commandes hôte lancées par `execFile` (jamais de shell), avec délai (120 s) et arguments séparés.
- Texte venu des agents et du dépôt (diff, noms de fichiers, rapports) : rendu par interpolation uniquement ; chaque ligne de diff passe par `commandeVisible` (caractères invisibles rendus visibles).
- Toute anomalie (pointe différente, document illisible) : refus de l'action, entrée « Refusé » au journal, jamais de reprise automatique.
- Textes de l'interface en français, tels que dans la maquette (annexe A).
- Tests : `npm test` (aucun appel API réel), `npm run typecheck`, `npm run test:web`, `npm run web:build` sans avertissement ; tests Docker ciblés `test-docker/*.test.ts` avec `--test-concurrency=1 --test-timeout=1800000`. Ne jamais affaiblir un test existant.
- Sous Linux : `export npm_config_script_shell=/bin/bash DOCKER_HOST=unix:///var/run/docker.sock` ; ne pas modifier `.npmrc`.

## Choix soumis à validation

1. **« Ouvrir une PR » s'exécute sur l'hôte** : récupère la branche si besoin, puis `git push -u origin <branche>` et `gh pr create` dans mon dépôt, avec mes propres identifiants, sur mon clic. Titre `T-41 · <titre>`, corps = critères d'acceptation validés + verdict QA (documents signés, pas de texte libre d'agent). Sans `gh` ou sans remote `origin` : message d'erreur avec les deux commandes à lancer à la main ; la branche reste récupérée. Alternative écartée : seulement afficher les commandes.
2. **Volumes supprimés à la fin** : quand une tâche passe `terminee` (branche récupérée ou PR) ou `abandonnee`, ses volumes (espace, mesures, copie de contrôle) sont supprimés. Le dossier signé (spec, plan, rapports, verdicts, journal) reste dans la base.
3. **Pas de « Restaurer la version validée »** : les agents reçoivent toujours les documents depuis le stock signé de l'orchestrateur, jamais depuis le workspace ; une altération du stock lui-même ne laisse aucune version sûre à restaurer. L'alerte d'intégrité propose « Reprendre », « Compter comme no-go et relancer » et « Abandonner la tâche ».
4. **Relances** : depuis une tâche bloquée, « Relancer » refait l'étape bloquée (reprise existante) ; « Relancer avec commentaire » repart en implémentation avec un compteur de no-go remis à 0 ; « Reprendre le cadrage » repart en cadrage (compteurs remis à 0, la spec et le plan devront être revalidés). Depuis une alerte d'intégrité, « Compter comme no-go et relancer » repart en implémentation avec un no-go de plus (3 → tâche bloquée).
5. **Branche créée dans mon dépôt sous le nom existant** `task/<n>` (ex. `task/41`) ; refus si une branche de ce nom existe avec un autre commit.
6. **Diff affiché plafonné à 2 Mo** avec bandeau « Diff tronqué : récupère la branche pour tout voir » ; la liste des fichiers (+/−) et le nombre de commits restent complets.
7. **Abandon** possible seulement quand aucun agent ne travaille (tâche en attente de moi, en pause ou bloquée), pour ne jamais couper une étape en vol.
8. **Hors phase 3** : écran Réglages (modèles, seuils par défaut), notifications, carte (phase 4).

---

## File Structure

Orchestrateur :
- Modify `src/taches/etats.ts` — événement `relance`, abandon restreint.
- Modify `src/integrite/artefacts.ts` — type `retour_humain`, `listerArtefacts`.
- Modify `src/pipeline/actions.ts` — `renvoyer`, `relancer`, `abandonner`.
- Modify `src/pipeline/prompts.ts` — `retour_humain` transmis au cadreur et à l'implémenteur.
- Create `src/conteneurs/validation.ts` — lectures de validation sur volume (commits, fichiers, diff, bundle).
- Create `src/validation/depot-hote.ts` — import du bundle dans mon dépôt, PR.
- Create `src/validation/service.ts` — dossier de validation, récupération, PR, nettoyage des volumes.
- Modify `src/reseau/serveur-ui.ts`, `src/orchestrateur.ts` — routes.
- Tests : `test/taches/etats.test.ts`, `test/integrite/artefacts.test.ts`, `test/pipeline/actions.test.ts`, `test/pipeline/prompts.test.ts`, `test/validation/depot-hote.test.ts`, `test/validation/service.test.ts`, `test/reseau/serveur-ui.test.ts`, `test-docker/validation.test.ts`.

Front :
- Modify `web/src/app/modeles.ts`, `web/src/app/api.ts`.
- Create `web/src/app/bureau/bureau.ts` (liste « Mon bureau »), `web/src/app/tache/validation.ts` (boîte de validation), `web/src/app/tache/diff.ts` (visionneuse), `web/src/app/tache/blocage.ts` (tâche bloquée), `web/src/app/tache/alerte.ts` (alerte d'intégrité) et leurs specs.
- Modify `web/src/app/tache/tache.ts`, `web/src/app/app.ts` (lien « Mon bureau »), `web/src/app/app.routes.ts`.

---

### Task 1: Machine à états, retour humain et actions de fin

**Files:**
- Modify: `src/taches/etats.ts`, `src/integrite/artefacts.ts`, `src/pipeline/actions.ts`, `src/pipeline/prompts.ts`
- Test: `test/taches/etats.test.ts`, `test/integrite/artefacts.test.ts`, `test/pipeline/actions.test.ts`, `test/pipeline/prompts.test.ts` (fichiers existants ; suivre leurs motifs)

**Interfaces:**
- Produces:
  - `Evenement` gagne `{ type: 'relance'; vers: 'implementation' | 'cadrage' }`.
  - `TypeArtefact` gagne `'retour_humain'` (contenu JSON `{ "vers": "implementation" | "cadrage", "texte": string }`).
  - `listerArtefacts(db, cle, tacheId, type): Artefact[]` — toutes les versions, vérifiées, de la plus ancienne à la plus récente.
  - `renvoyer(db, cle, tacheId, commentaire: string): Tache`
  - `relancer(db, cle, tacheId, vers: 'implementation' | 'cadrage', commentaire: string | null): Tache`
  - `abandonner(db, cle, tacheId): Tache`

Règles de transition (dans `transition`) :
- `relance` :
  - statut `bloquee` → `vers: 'implementation'` : `prete('implementation', { essaisQa: 0 })` ; `vers: 'cadrage'` : `prete('cadrage', { essaisQa: 0, echangesPlan: 0 })`.
  - statut `en_pause` avec raison commençant par `integrite` → seulement `vers: 'implementation'` : `essaisQa + 1` ; si `< MAX_ESSAIS_QA` → `prete('implementation', { essaisQa })`, sinon `{ ...e, essaisQa, statut: 'bloquee', raison: '3 no-go du QA : la tâche me revient' }` (même texte que l'existant, construit avec `MAX_ESSAIS_QA`).
  - tout autre cas : refus.
- `abandon` : seulement depuis `attente_humain`, `en_pause` ou `bloquee` (refus depuis `prete` et `en_cours`).

- [ ] **Step 1: Tests qui échouent** — dans `test/taches/etats.test.ts` :

```ts
test('relance depuis bloquée : implémentation ou cadrage, compteurs remis à zéro', () => {
  const bloquee: EtatTache = { etape: 'qa', statut: 'bloquee', raison: '3 no-go du QA : la tâche me revient', echangesPlan: 1, essaisQa: 3 };
  assert.deepEqual(transition(bloquee, { type: 'relance', vers: 'implementation' }), { ...bloquee, etape: 'implementation', statut: 'prete', raison: null, essaisQa: 0 });
  assert.deepEqual(transition(bloquee, { type: 'relance', vers: 'cadrage' }), { ...bloquee, etape: 'cadrage', statut: 'prete', raison: null, essaisQa: 0, echangesPlan: 0 });
});

test('relance après une alerte d’intégrité : compte un no-go', () => {
  const pause: EtatTache = { etape: 'qa', statut: 'en_pause', raison: 'integrite : la branche a changé', echangesPlan: 0, essaisQa: 1 };
  assert.deepEqual(transition(pause, { type: 'relance', vers: 'implementation' }), { ...pause, etape: 'implementation', statut: 'prete', raison: null, essaisQa: 2 });
  const derniere = { ...pause, essaisQa: 2 };
  assert.deepEqual(transition(derniere, { type: 'relance', vers: 'implementation' }), { ...derniere, statut: 'bloquee', essaisQa: 3, raison: '3 no-go du QA : la tâche me revient' });
  assert.throws(() => transition(pause, { type: 'relance', vers: 'cadrage' }), TransitionInvalide);
});

test('relance refusée hors blocage et hors alerte d’intégrité', () => {
  for (const e of [
    { etape: 'implementation', statut: 'en_cours', raison: null, echangesPlan: 0, essaisQa: 0 },
    { etape: 'implementation', statut: 'en_pause', raison: 'budget : plafond', echangesPlan: 0, essaisQa: 0 },
    { etape: 'validation', statut: 'attente_humain', raison: 'en attente de ma validation', echangesPlan: 0, essaisQa: 0 },
  ] as EtatTache[]) assert.throws(() => transition(e, { type: 'relance', vers: 'implementation' }), TransitionInvalide);
});

test('abandon seulement quand aucun agent ne travaille', () => {
  const base = { etape: 'implementation', raison: null, echangesPlan: 0, essaisQa: 0 } as const;
  for (const statut of ['attente_humain', 'en_pause', 'bloquee'] as const)
    assert.equal(transition({ ...base, statut }, { type: 'abandon' }).statut, 'abandonnee');
  for (const statut of ['prete', 'en_cours'] as const)
    assert.throws(() => transition({ ...base, statut }, { type: 'abandon' }), TransitionInvalide);
});
```

Si un test existant abandonne depuis `prete` ou `en_cours`, il décrit l'ancien comportement : le signaler dans le rapport et l'adapter au nouveau (choix 7 validé), sans retirer d'autre assertion.

Dans `test/integrite/artefacts.test.ts` : `listerArtefacts` rend les trois versions d'un type dans l'ordre ; une version altérée en base (UPDATE du `contenu`) lève `AnomalieIntegrite` ; une version supprimée (DELETE) lève `AnomalieIntegrite` ; un type sans version rend `[]`.

Dans `test/pipeline/actions.test.ts` (base et clé comme les tests existants) :
- `renvoyer` : tâche en `validation`/`attente_humain` → `implementation`/`prete`, `essaisQa` 0, artefact `retour_humain` = `{"vers":"implementation","texte":"Ajoute le test du cas vide"}`, entrée de journal `renvoi avec commentaire` (décideur `Moi`) ; commentaire vide → `Error('commentaire requis')` et rien n'est signé ; tâche hors validation → erreur et rien n'est signé.
- `relancer` : depuis `bloquee`, avec commentaire → artefact `retour_humain` `vers` correspondant ; sans commentaire (`null`) → aucun artefact ; journal `relance (implémentation)` / `relance (cadrage)`. État invalide → erreur, rien de signé.
- `abandonner` : depuis `bloquee` → `abandonnee`, journal `abandon de la tâche` ; depuis `en_cours` → erreur.

Dans `test/pipeline/prompts.test.ts` :
- implémentation avec un `retour_humain` (`vers: implementation`) plus récent que le dernier `resume` → `documentsEtape` contient `retour_humain` = le texte, et aussi `verdict_qa`, `rapport_review`, `avis_patron_code`, `analyse` s'ils existent (même avec `essaisQa` = 0) ;
- un `retour_humain` plus ancien que le dernier `resume` n'est plus transmis ;
- cadrage avec un `retour_humain` (`vers: cadrage`) plus récent que la dernière `spec` → `retour_humain` transmis ; un `retour_humain` `vers: implementation` n'est jamais transmis au cadreur.

Run: `node --disable-warning=ExperimentalWarning --test test/taches/etats.test.ts test/integrite/artefacts.test.ts test/pipeline/actions.test.ts test/pipeline/prompts.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implémentation.**

`src/taches/etats.ts` — ajouter `| { type: 'relance'; vers: 'implementation' | 'cadrage' }` à `Evenement`, puis dans `transition` :

```ts
    case 'abandon':
      return e.statut === 'attente_humain' || e.statut === 'en_pause' || e.statut === 'bloquee' ? { ...e, statut: 'abandonnee', raison: null } : refuser();
    case 'relance': {
      if (e.statut === 'bloquee') return ev.vers === 'implementation' ? prete('implementation', { essaisQa: 0 }) : prete('cadrage', { essaisQa: 0, echangesPlan: 0 });
      // Alerte d'intégrité : « compter comme no-go et relancer ».
      if (e.statut !== 'en_pause' || !e.raison?.startsWith('integrite') || ev.vers !== 'implementation') return refuser();
      const essaisQa = e.essaisQa + 1;
      return essaisQa < MAX_ESSAIS_QA
        ? prete('implementation', { essaisQa })
        : { ...e, essaisQa, statut: 'bloquee', raison: `${MAX_ESSAIS_QA} no-go du QA : la tâche me revient` };
    }
```

`src/integrite/artefacts.ts` — `TypeArtefact` gagne `'retour_humain'` ;

```ts
export function listerArtefacts(db: Base, cle: Buffer, tacheId: string, type: TypeArtefact): Artefact[] {
  const lignes = lignesDuType(db, tacheId, type);
  const versions = lignes.map(l => verifier(cle, l));
  verifierType(db, cle, tacheId, type, lignes);
  return versions;
}
```

`src/pipeline/actions.ts` :

```ts
const retour = (db: Base, cle: Buffer, tacheId: string, vers: 'implementation' | 'cadrage', texte: string) =>
  enregistrerArtefact(db, cle, tacheId, 'retour_humain', JSON.stringify({ vers, texte }));

export function renvoyer(db: Base, cle: Buffer, tacheId: string, commentaire: string): Tache {
  const texte = commentaire.trim();
  if (!texte) throw new Error('commentaire requis');
  const t = lireTache(db, tacheId);
  // État vérifié avant toute signature : un refus ne laisse aucun document signé.
  if (t.etape !== 'validation' || t.statut !== 'attente_humain') throw new Error(`${tacheId} n’attend pas ma validation`);
  retour(db, cle, tacheId, 'implementation', texte);
  const suite = appliquer(db, tacheId, { type: 'validation', decision: 'renvoi' });
  journaliser(db, cle, tacheId, 'renvoi avec commentaire', texte.slice(0, 200));
  return suite;
}

export function relancer(db: Base, cle: Buffer, tacheId: string, vers: 'implementation' | 'cadrage', commentaire: string | null): Tache {
  const t = lireTache(db, tacheId);
  transition(t, { type: 'relance', vers }); // lève avant toute signature si la relance est impossible
  const texte = commentaire?.trim();
  if (texte) retour(db, cle, tacheId, vers, texte);
  const suite = appliquer(db, tacheId, { type: 'relance', vers });
  journaliser(db, cle, tacheId, `relance (${vers === 'implementation' ? 'implémentation' : 'cadrage'})`, texte?.slice(0, 200) || t.raison || t.statut);
  return suite;
}

export function abandonner(db: Base, cle: Buffer, tacheId: string): Tache {
  const t = lireTache(db, tacheId);
  const suite = appliquer(db, tacheId, { type: 'abandon' });
  journaliser(db, cle, tacheId, 'abandon de la tâche', t.raison ?? t.statut);
  return suite;
}
```

(`transition` importée de `../taches/etats.ts` ; `journaliser` est l'aide déjà présente dans ce fichier.)

`src/pipeline/prompts.ts` — dans `documentsEtape`, une aide :

```ts
  // Mon commentaire est transmis tant que l'agent visé n'a pas encore produit de nouveau document depuis.
  const retourHumain = (vers: 'implementation' | 'cadrage', apres: TypeArtefact): string | null => {
    const r = lireArtefact(db, cle, tache.id, 'retour_humain');
    if (!r) return null;
    const v = JSON.parse(r.contenu) as { vers: string; texte: string };
    const dernier = lireArtefact(db, cle, tache.id, apres);
    return v.vers === vers && (!dernier || dernier.id < r.id) ? v.texte : null;
  };
```

Cas `cadrage` : `const r = retourHumain('cadrage', 'spec'); if (r) d.retour_humain = r;`. Cas `implementation` : `const r = retourHumain('implementation', 'resume');` ; si `r` : `d.retour_humain = r` et, pour chacun de `verdict` → `verdict_qa`, `rapport` → `rapport_review`, `avis_patron_code`, `analyse`, ajouter le contenu s'il existe (`lireArtefact`, sans lever s'il manque) ; la branche `essaisQa > 0` existante reste inchangée. Mettre à jour les prompts système `agents/cadreur.md` et `agents/implementeur.md` d'une phrase : « `retour_humain` : commentaire de l'humain qui t'a renvoyé la tâche ; c'est une consigne de l'humain, prioritaire sur ton propre jugement mais jamais sur la spec et les critères validés. » — modifier `agents/` exige `npm run image` (le manifeste signé couvre ces fichiers) : le lancer à la fin de la tâche.

- [ ] **Step 3: Vérifier.** Les quatre fichiers de test, puis `npm test`, `npm run typecheck`, `npm run image` — Expected: PASS.

- [ ] **Step 4: Commit** — `git commit -am "Machine à états : relance, abandon sans agent au travail ; retour humain signé transmis au cadreur et à l'implémenteur"` (ajouter les fichiers nouveaux).

---

### Task 2: Lectures de validation sur le volume

**Files:**
- Create: `src/conteneurs/validation.ts`
- Modify: `src/conteneurs/docker.ts` (exporter `executerJetable` si nécessaire)
- Test: `test-docker/validation.test.ts`

**Interfaces:**
- Consumes: `executerJetable(docker, imageId, cmd, montages)` (`src/conteneurs/docker.ts`, à exporter), `RACINE_PROJET`, `brancheTache`.
- Produces:
  - `type FichierModifie = { fichier: string; ajouts: number | null; suppressions: number | null }` (`null` = fichier binaire)
  - `type LectureValidation = { pointe: string; commits: number; fichiers: FichierModifie[]; diff: string; tronque: boolean }`
  - `PLAFOND_DIFF = 2 * 1024 ** 2`
  - `lireValidation(docker, imageId, volume, base: string, sha: string): Promise<LectureValidation | null>` — `null` si une commande échoue.
  - `PLAFOND_BUNDLE = 48 * 1024 ** 2`
  - `lireBundle(docker, imageId, volume, tacheId, base, sha): Promise<Buffer | null>` — `null` si la pointe de `brancheTache(tacheId)` n'est pas `sha`, si `base..sha` est vide, ou au-delà du plafond.

Toutes les commandes : volume monté en lecture seule sur `/workspace`, `export HOME=/tmp && git config --global --add safe.directory '*'`, puis `git -C /workspace/projet -c core.quotePath=false …` avec `--no-ext-diff --no-textconv --no-color` pour `diff`. `base` et `sha` sont vérifiés `^[0-9a-f]{40}$` avant tout appel (sinon `null`), et passés en arguments positionnels (`sh -c '…' lecture "$base" "$sha"`), jamais interpolés dans le script.

- [ ] **Step 1: Test Docker qui échoue** — `test-docker/validation.test.ts`, sur le modèle de `test-docker/conteneurs.test.ts` (même préparation d'image et de volume ; un espace préparé avec `preparerEspace` sur un dépôt temporaire `git init` contenant `a.txt`, puis deux commits ajoutés sur la branche de la tâche par un conteneur jetable qui écrit `b.txt` et modifie `a.txt`) :
  - `lireValidation(…, base, pointe)` → `commits: 2`, `fichiers` contient `{ fichier: 'a.txt', ajouts: 1, suppressions: 1 }` et `{ fichier: 'b.txt', ajouts: 1, suppressions: 0 }`, `diff` contient `+++ b/b.txt`, `tronque: false`, `pointe` = SHA de la branche ;
  - un fichier de 3 Mo ajouté → `tronque: true`, `diff.length <= PLAFOND_DIFF` ;
  - `base` non hexadécimal → `null` ;
  - `lireBundle(…, base, pointe)` → un `Buffer` qui commence par `# v2 git bundle` (ou `# v3`), et `git bundle list-heads` sur ce fichier (hôte) liste `refs/heads/task/<n>` au SHA attendu ;
  - `lireBundle` avec un `sha` différent de la pointe → `null`.
  Nettoyer volumes et dépôts temporaires dans `after`.

Run: `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=1800000 test-docker/validation.test.ts` — Expected: FAIL (module absent).

- [ ] **Step 2: Implémentation** — `src/conteneurs/validation.ts` :

```ts
import type Docker from 'dockerode';
import { brancheTache, executerJetable, RACINE_PROJET } from './docker.ts';

export type FichierModifie = { fichier: string; ajouts: number | null; suppressions: number | null };
export type LectureValidation = { pointe: string; commits: number; fichiers: FichierModifie[]; diff: string; tronque: boolean };
export const PLAFOND_DIFF = 2 * 1024 ** 2;
export const PLAFOND_BUNDLE = 48 * 1024 ** 2;

const SHA = /^[0-9a-f]{40}$/;
const PREAMBULE = `export HOME=/tmp && git config --global --add safe.directory '*' && cd ${RACINE_PROJET}`;
const lecture = (volume: string): Docker.MountConfig => [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }];

async function git(docker: Docker, imageId: string, volume: string, script: string, args: string[]) {
  return executerJetable(docker, imageId, ['sh', '-c', `${PREAMBULE} && ${script}`, 'validation', ...args], lecture(volume));
}

export async function lireValidation(docker: Docker, imageId: string, volume: string, base: string, sha: string): Promise<LectureValidation | null> {
  if (!SHA.test(base) || !SHA.test(sha)) return null;
  const pointe = await git(docker, imageId, volume, 'git rev-parse HEAD', []);
  const commits = await git(docker, imageId, volume, 'git rev-list --count "$1..$2"', [base, sha]);
  const stat = await git(docker, imageId, volume, 'git -c core.quotePath=false diff --no-ext-diff --no-textconv --no-color -M --numstat -z "$1" "$2"', [base, sha]);
  const diff = await git(docker, imageId, volume, `git -c core.quotePath=false diff --no-ext-diff --no-textconv --no-color -M -U3 "$1" "$2" | head -c ${PLAFOND_DIFF + 1}`, [base, sha]);
  if ([pointe, commits, stat, diff].some(r => r.code !== 0)) return null;
  const p = pointe.stdout.toString('utf8').trim();
  if (!SHA.test(p)) return null;
  return {
    pointe: p,
    commits: Number(commits.stdout.toString('utf8').trim()),
    fichiers: lireNumstat(stat.stdout.toString('utf8')),
    diff: diff.stdout.subarray(0, PLAFOND_DIFF).toString('utf8'),
    tronque: diff.stdout.length > PLAFOND_DIFF,
  };
}

// --numstat -z : « ajouts\tsuppressions\tchemin\0 », ou pour un renommage « a\ts\t\0ancien\0nouveau\0 » ; « - » = binaire.
function lireNumstat(brut: string): FichierModifie[] {
  const morceaux = brut.split('\0');
  const fichiers: FichierModifie[] = [];
  for (let i = 0; i < morceaux.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(morceaux[i]);
    if (!m) continue;
    const nombre = (s: string) => (s === '-' ? null : Number(s));
    let fichier = m[3];
    if (fichier === '') { fichier = `${morceaux[i + 1]} → ${morceaux[i + 2]}`; i += 2; }
    fichiers.push({ fichier, ajouts: nombre(m[1]), suppressions: nombre(m[2]) });
  }
  return fichiers;
}

export async function lireBundle(docker: Docker, imageId: string, volume: string, tacheId: string, base: string, sha: string): Promise<Buffer | null> {
  if (!SHA.test(base) || !SHA.test(sha) || base === sha) return null;
  const branche = brancheTache(tacheId);
  // La pointe est relue dans le même conteneur que le bundle : aucune fenêtre entre la vérification et la fabrication.
  const script = `[ "$(git rev-parse "refs/heads/$3")" = "$2" ] || exit 4; git bundle create /tmp/b.bundle "$1..refs/heads/$3" 2>/dev/null || exit 5; `
    + `[ "$(stat -c %s /tmp/b.bundle)" -le ${PLAFOND_BUNDLE} ] || exit 6; base64 -w0 /tmp/b.bundle`;
  const r = await git(docker, imageId, volume, script, [base, sha, branche]);
  if (r.code !== 0) return null;
  const bundle = Buffer.from(r.stdout.toString('utf8'), 'base64');
  return bundle.length > 0 && bundle.length <= PLAFOND_BUNDLE ? bundle : null;
}
```

Le tmpfs `/tmp` des conteneurs jetables fait 64 Mo : un bundle de 48 Mo y tient. Si `executerJetable` n'est pas exporté, l'exporter tel quel (aucun autre changement).

- [ ] **Step 3: Vérifier.** Le test Docker, puis `npm test` et `npm run typecheck` — Expected: PASS.

- [ ] **Step 4: Commit** — `git add src/conteneurs test-docker/validation.test.ts && git commit -m "Validation : diff, fichiers modifiés et bundle de la branche lus en lecture seule"`

---

### Task 3: Import dans mon dépôt et pull request sur l'hôte

**Files:**
- Create: `src/validation/depot-hote.ts`
- Test: `test/validation/depot-hote.test.ts`

**Interfaces:**
- Produces:
  - `type Executer = (commande: string, args: string[], o: { cwd: string }) => Promise<{ code: number; stdout: string; stderr: string }>`
  - `executerHote: Executer` — `execFile` sans shell, délai 120 s, `maxBuffer` 10 Mo, environnement hérité plus `GIT_TERMINAL_PROMPT=0`.
  - `importerBranche(executer: Executer, cheminDepot: string, bundle: Buffer, branche: string, sha: string): Promise<'importee' | 'deja_presente'>` — lève `Error` avec un message français sinon.
  - `ouvrirPr(executer: Executer, cheminDepot: string, branche: string, titre: string, corps: string): Promise<string>` — rend l'URL de la PR.

Règles de `importerBranche` :
1. `sha` doit être 40 hex ; `branche` doit correspondre à `^task/[0-9a-z-]+$`.
2. Écrire le bundle dans un fichier temporaire (`fs.mkdtempSync(os.tmpdir()/bureau-bundle-)`, mode 0600), supprimé dans `finally`.
3. `git -C <dépôt> rev-parse --git-dir` doit réussir (sinon `Error('<dépôt> n’est pas un dépôt Git')`).
4. Si `git -C <dépôt> rev-parse --verify --quiet refs/heads/<branche>` réussit : même `sha` → `'deja_presente'` ; autre → `Error('la branche <branche> existe déjà dans ton dépôt sur un autre commit : rien n’a été modifié')`.
5. `git -C <dépôt> bundle verify <fichier>` doit réussir (sinon `Error('bundle refusé par git : <stderr tronqué à 300>')` — typiquement le commit de base absent de mon dépôt).
6. `git -C <dépôt> -c core.hooksPath=/dev/null fetch --no-tags --no-write-fetch-head <fichier> refs/heads/<branche>:refs/heads/<branche>`.
7. Relire `refs/heads/<branche>` : différent de `sha` → supprimer la réf créée (`git update-ref -d refs/heads/<branche> <valeur lue>`) puis `Error('commit importé différent du commit analysé : branche retirée')`.

Règles de `ouvrirPr` : `git -C <dépôt> remote get-url origin` (échec → `Error('aucun remote origin : pousse la branche puis ouvre la PR à la main : git push -u origin <branche> && gh pr create --head <branche>')`) ; `git -C <dépôt> push -u origin <branche>` ; `gh pr create --head <branche> --title <titre> --body <corps>` avec `cwd` = dépôt ; `gh` absent (`ENOENT`) → même message avec les commandes ; l'URL est la dernière ligne non vide de la sortie de `gh` commençant par `https://`.

- [ ] **Step 1: Tests qui échouent** — `test/validation/depot-hote.test.ts`, avec de vrais dépôts temporaires et le vrai `git` de l'hôte (comme les fixtures de tests existants qui appellent git ; sinon `execFileSync('git', …)` dans le test) :

```ts
// Préparation : `origine` (git init, un commit « base »), `travail` cloné depuis `origine` où l'on crée task/41 avec un commit,
// puis `git bundle create b.bundle base..task/41` dans `travail` → Buffer. `depot` = un autre clone de `origine` (le dépôt de l'utilisateur).
```

Cas :
- import → `'importee'`, `git -C depot rev-parse task/41` = sha, la branche courante de `depot` est inchangée, aucun fichier de travail modifié (`git status --porcelain` vide) ;
- second import identique → `'deja_presente'` ;
- `task/41` existe déjà dans `depot` sur un autre commit → erreur « existe déjà … rien n’a été modifié », réf inchangée ;
- `sha` attendu différent du commit du bundle → erreur « commit importé différent », et `task/41` n'existe pas dans `depot` ;
- dépôt sans le commit de base (dépôt `git init` vide) → erreur « bundle refusé par git » ;
- dossier qui n'est pas un dépôt → erreur « n’est pas un dépôt Git » ;
- un hook `reference-transaction` exécutable dans `depot/.git/hooks/` qui écrit un fichier témoin : après import, le témoin n'existe pas ;
- `branche` = `main` ou `task/41;rm` → erreur avant tout appel (doublure `Executer` qui échoue si appelée).
`ouvrirPr` avec une doublure `Executer` qui enregistre les appels : ordre `remote get-url`, `push -u origin task/41`, `gh pr create --head task/41 --title … --body …` (arguments séparés, jamais une chaîne de shell) ; URL extraite ; `remote` absent → message avec les deux commandes ; `gh` absent (la doublure rejette une erreur `{ code: 'ENOENT' }`) → même message.

Run: `node --disable-warning=ExperimentalWarning --test test/validation/depot-hote.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implémentation** de `src/validation/depot-hote.ts` selon les règles ci-dessus :

```ts
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Executer = (commande: string, args: string[], o: { cwd: string }) => Promise<{ code: number; stdout: string; stderr: string }>;

export const executerHote: Executer = (commande, args, o) => new Promise((ok, ko) => {
  execFile(commande, args, { cwd: o.cwd, timeout: 120_000, maxBuffer: 10 * 1024 ** 2, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return ko(err);
    ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
  });
});
```

Puis `importerBranche` et `ouvrirPr` en suivant les étapes numérotées (une fonction locale `git(...args)` qui appelle `executer('git', ['-C', cheminDepot, ...args], { cwd: cheminDepot })`).

- [ ] **Step 3: Vérifier.** Le fichier de test, `npm test`, `npm run typecheck` — Expected: PASS.

- [ ] **Step 4: Commit** — `git add src/validation test/validation && git commit -m "Validation : import vérifié du bundle dans mon dépôt, PR avec git et gh sur l'hôte"`

---

### Task 4: Service de validation, routes et nettoyage

**Files:**
- Create: `src/validation/service.ts`
- Modify: `src/reseau/serveur-ui.ts`, `src/orchestrateur.ts`
- Test: `test/validation/service.test.ts`, `test/reseau/serveur-ui.test.ts`, `test-docker/validation.test.ts` (ajout d'un parcours)

**Interfaces:**
- Consumes: tâches 1 à 3 ; `lireAnalyse` (lecteur de l'analyse signée utilisé par le pipeline, `src/pipeline/pipeline.ts` — l'exporter s'il ne l'est pas), `lireArtefact`, `listerArtefacts`, `commitBase(db, id)`, `nomRessource`, `nomVolumeMesures`, `nomCopie`, `brancheTache`, `ajouterAuJournal`, `lireJournal`.
- Produces :
  - `type DepsValidation = { db: Base; cle: Buffer; lire: (volume: string, base: string, sha: string) => Promise<LectureValidation | null>; bundle: (volume: string, tacheId: string, base: string, sha: string) => Promise<Buffer | null>; executer: Executer; supprimerVolumes: (tacheId: string) => Promise<void> }`
  - `type DossierValidation = { branche: string; sha: string; commits: number; fichiers: FichierModifie[]; diff: string; tronque: boolean; integrite: { verifiee: true } | { verifiee: false; raison: string }; journal: { commandes: number; refus: number; escalades: number } }`
  - `dossierValidation(deps, tacheId): Promise<DossierValidation>`
  - `recupererBranche(deps, tacheId): Promise<Tache>` → `terminee` (décision `branche`), volumes supprimés.
  - `ouvrirPullRequest(deps, tacheId): Promise<{ tache: Tache; url: string }>` → `terminee` (décision `pr`), volumes supprimés.
  - `historique(deps, tacheId): { creeLe: string; verdict: 'go' | 'no_go'; regles: string[]; criteresNonRemplis: { numero: number; preuve: string }[] }[]` (versions de `verdict`, plus récente en premier).
  - Routes : `GET /api/taches/:id/validation` → `DossierValidation` ; `GET /api/taches/:id/historique` → historique ; actions `POST /api/taches/:id/recuperation` `{}`, `/pr` `{}`, `/renvoi` `{ commentaire }`, `/relance` `{ vers, commentaire? }`, `/abandon` `{}`. `NomAction` gagne ces cinq noms ; la route d'action devient asynchrone (`await routes.action(...)`), erreurs métier → 409.

Règles :
- `dossierValidation` : tâche en `validation`/`attente_humain` sinon `Error('<id> n’attend pas ma validation')`. `sha` = `lireAnalyse(...).sha` (signé), `base` = `commitBase`. `lire(volume, base, sha)` ; `null` → `Error('lecture de la branche impossible')`. Si `lecture.pointe !== sha` → `integrite: { verifiee: false, raison: 'la branche a changé depuis l’analyse (pointe <7 car.> au lieu de <7 car.>)' }` et entrée de journal « Refusé », décideur « Contrôleur d’intégrité », commande `contrôle de la branche avant validation`. `verifierArtefactsTache` est appelé : une `AnomalieIntegrite` donne `verifiee: false` avec son message (pas d'exception). `journal` : sur `lireJournal(db, id)`, `commandes` = entrées `type === 'decision'`, `refus` = décision `Refusé`, `escalades` = lignes de la table `escalades` pour la tâche.
- `recupererBranche` : même contrôle d'état ; recalcule `dossierValidation` ; `integrite.verifiee === false` → `Error('récupération refusée : <raison>')` + journal « Refusé ». `bundle(...)` ; `null` → `Error('bundle de la branche impossible (pointe changée, branche vide ou trop volumineuse)')` + journal « Refusé ». `importerBranche(executer, tache.cheminProjet, bundle, brancheTache(id), sha)`. Journal « Autorisé », décideur « Moi », commande `git fetch <bundle> <branche> → <cheminProjet>`. `appliquer(validation, branche)`. `supprimerVolumes(id)` (erreur de suppression journalisée, jamais remontée : la tâche est terminée).
- `ouvrirPullRequest` : import comme ci-dessus (idempotent : `deja_presente` accepté) **sans** transition ; puis `ouvrirPr(executer, chemin, branche, \`${id} · ${titre}\`, corps)`, corps = `## Critères d'acceptation\n\n<critères signés>\n\n## Verdict QA\n\n<GO|NO-GO>, <n> critères remplis sur <total>` (depuis `criteres` et `verdict` signés). Échec de la PR → `Error('branche récupérée dans ton dépôt ; PR impossible : <message>')`, la tâche reste en validation (je peux réessayer ou choisir « Récupérer la branche »). Succès → journal (commande `gh pr create`, raison = URL), `appliquer(validation, pr)`, `supprimerVolumes`.
- `abandon` (route) : `abandonner(...)` puis `arreterConteneurs(docker, id)` et `supprimerVolumes(id)` ; erreurs de nettoyage journalisées seulement.
- `supprimerVolumes` (câblage) : supprime `nomRessource(id)`, `nomVolumeMesures(id)`, `nomCopie(id)` (404 ignoré).

- [ ] **Step 1: Tests qui échouent.**
  `test/validation/service.test.ts` — base `:memory:`/temporaire, clé de test, doublures `lire`, `bundle`, `executer`, `supprimerVolumes` ; une tâche amenée en `validation`/`attente_humain` avec `spec`, `criteres`, `plan`, `analyse` (`{ sha: S, base: B, … }`), `verdict` signés et `commit_base` = B :
  - dossier : pointe = S → `verifiee: true`, champs recopiés de la lecture, compteurs de journal ;
  - pointe ≠ S → `verifiee: false`, raison mentionnant les deux SHA courts, entrée de journal « Refusé » ;
  - artefact altéré en base → `verifiee: false` avec le message de l'anomalie ;
  - récupération : `importerBranche` reçoit le bundle et `task/<n>` ; tâche `terminee` ; `supprimerVolumes` appelé une fois ; journal « Autorisé » ;
  - récupération avec pointe ≠ S → erreur, tâche toujours en validation, `bundle` jamais appelé, `supprimerVolumes` jamais appelé ;
  - `bundle` → null → erreur, tâche inchangée ;
  - PR : `gh` réussit → tâche `terminee`, URL rendue, corps contenant les critères ; `gh` échoue → erreur « branche récupérée dans ton dépôt ; PR impossible », tâche en validation, volumes conservés ;
  - historique : trois verdicts signés → trois entrées, la plus récente d'abord, `criteresNonRemplis` extraits.
  `test/reseau/serveur-ui.test.ts` : routes `GET …/validation`, `GET …/historique` (200, et 409 `{ erreur }` quand la route lève) ; les cinq actions transmettent nom et corps (`relance` : `vers` doit valoir `implementation` ou `cadrage`, sinon 400 ; `renvoi` : `commentaire` chaîne non vide sinon 400) ; une action asynchrone qui rejette → 409 ; jeton requis.
  `test-docker/validation.test.ts`, nouveau cas (si l'orchestrateur ne peut pas être monté à part, appeler directement `recupererBranche` avec les vraies dépendances Docker et `executerHote`) : tâche préparée sur un dépôt temporaire, deux commits sur la branche, analyse signée avec la pointe, `recupererBranche` → `git -C <dépôt> rev-parse task/<n>` = pointe ; volume de la tâche supprimé.

Run: `node --disable-warning=ExperimentalWarning --test test/validation/service.test.ts test/reseau/serveur-ui.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implémentation** de `src/validation/service.ts` selon les règles ; routes et `NomAction` dans `src/reseau/serveur-ui.ts` (validation des corps comme décrit) ; câblage dans `src/orchestrateur.ts` :

```ts
  const depsValidation: DepsValidation = {
    db, cle, executer: executerHote,
    lire: (volume, base, sha) => lireValidation(docker, manifeste.image, volume, base, sha),
    bundle: (volume, tacheId, base, sha) => lireBundle(docker, manifeste.image, volume, tacheId, base, sha),
    supprimerVolumes: async tacheId => {
      for (const v of [nomRessource(tacheId), nomVolumeMesures(tacheId), nomCopie(tacheId)])
        await docker.getVolume(v).remove({ force: true }).catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; });
    },
  };
```

et dans `action` : `recuperation` → `recupererBranche(depsValidation, id)` ; `pr` → `ouvrirPullRequest(depsValidation, id)` ; `renvoi` → `renvoyer(db, cle, id, String(c.commentaire))` ; `relance` → `relancer(db, cle, id, c.vers, typeof c.commentaire === 'string' ? c.commentaire : null)` ; `abandon` → `abandonner` puis nettoyage. Routes `validation` → `dossierValidation(depsValidation, id)`, `historique` → `historique(depsValidation, id)`. `codeHttp` est l'aide déjà utilisée dans `src/conteneurs/docker.ts` / `src/analyse/execution.ts` : la réutiliser (l'exporter si besoin).

- [ ] **Step 3: Vérifier.** Tests ciblés, `npm test`, `npm run typecheck`, puis `test-docker/validation.test.ts` — Expected: PASS.

- [ ] **Step 4: Commit** — `git commit -am "Validation : dossier vérifié, récupération de la branche, PR, renvoi, relance, abandon ; volumes supprimés en fin de tâche"` (ajouter les nouveaux fichiers).

---

### Task 5: Mon bureau — boîte de validation

**Files:**
- Modify: `web/src/app/modeles.ts`, `web/src/app/api.ts`, `web/src/app/tache/tache.ts`, `web/src/app/app.ts`, `web/src/app/app.routes.ts`
- Create: `web/src/app/bureau/bureau.ts`, `web/src/app/tache/validation.ts`, `web/src/app/tache/diff.ts` et leurs specs

**Interfaces:**
- Consumes: routes de la tâche 4.
- Produces:
  - `modeles.ts` : `FichierModifie`, `DossierValidation`, `EntreeHistorique` (mêmes champs que côté serveur) ; `NomAction` gagne `'recuperation' | 'pr' | 'renvoi' | 'relance' | 'abandon'`.
  - `ApiService` : `validation(id)`, `historique(id)` ; `action` accepte les nouveaux noms (réponse `pr` : `{ tache, url }`).
  - `Bureau` (route `bureau`) ; `ValidationVue` (`input.required<string>()` id) ; `DiffVue` (`input.required<{ diff: string; fichiers: FichierModifie[]; tronque: boolean }>()`).

Comportement :
- En-tête (lien « Mon bureau » avec pastille = tâches en `validation`/`attente_humain` + tâches `bloquee`).
- `Bureau` : « Mon bureau · Boîte de validation » ; liste des tâches à valider puis des tâches bloquées (`{id} · {projet}`, titre, `budget()`), chacune liant `/taches/{id}` ; vide : « Rien à valider pour l'instant. »
- `TacheVue`, état `validation`/`attente_humain` : remplace le texte provisoire de 2c par `ValidationVue`.
- `ValidationVue` charge `validation(id)` une fois (et sur « Recharger ») :
  - en-tête `{id} · {projet}`, titre, `{branche} · {commits} commits · +{Σ ajouts} −{Σ suppressions}` ;
  - « ✓ Intégrité vérifiée » (classe `go`) ou « ✕ Intégrité non vérifiée : {raison} » (classe `nogo`) ;
  - « Verdict QA : GO » / « NO-GO » depuis le document `verdict` de la fiche ;
  - onglets « Diff » (`DiffVue`), « Rapports » (`RapportVue` existant), « Avis du patron » (`documents.avis_patron_code` en `<pre>`, titre « Note critique non bloquante · Patron · d'après le diff et les rapports »), « Journal » (« {commandes} commandes », « {refus} refus », « {escalades} escalade(s) », puis le journal de la tâche comme l'onglet Activité) ;
  - boutons « Récupérer la branche », « Ouvrir une PR » (désactivés si l'intégrité n'est pas vérifiée), « Renvoyer avec commentaire » (dialogue : zone de texte, « Annuler », « Renvoyer » désactivé si vide), « Abandonner » (confirmation « Abandonner {id} ? La branche n'est pas récupérée et l'espace de la tâche est supprimé. » / « Annuler » / « Abandonner ») ;
  - succès : « Branche {branche} récupérée dans ton dépôt. », « PR ouverte : {url} » (texte, pas de lien cliquable automatique : l'URL vient de `gh`), « Tâche renvoyée à l'implémenteur. », « Tâche abandonnée. » ; erreur 409 affichée telle quelle ; boutons désactivés pendant l'appel.
- `DiffVue` : liste des fichiers (`fichier` passé par `commandeVisible`, `+a −s` ou « binaire ») ; cliquer un fichier n'affiche que sa section du diff (découpage sur les lignes `diff --git `) ; chaque ligne rendue en `<span>` avec classe `ajout` (`+`, hors `+++`), `retrait` (`-`, hors `---`), `entete` (`@@`, `diff --git`, `index`, `---`, `+++`) ; texte de chaque ligne via `commandeVisible(...).texte`, et bandeau « Caractères invisibles ou de contrôle présents dans le diff » si l'une est suspecte ; `tronque` → bandeau « Diff tronqué : récupère la branche pour tout voir ». Styles : `pre-wrap`, `overflow-wrap: anywhere`, police `--fm`, couleurs `--ok`/`--ko`/`--doux`.

- [ ] **Step 1: Tests qui échouent.** `diff.spec.ts` : classes des lignes ; sélection d'un fichier ; ligne contenant U+202E → marqueur `⟦U+202E⟧` et bandeau ; `<img src=x onerror=alert(1)>` dans le diff → aucun élément `img` ; `tronque` → bandeau ; fichier binaire → « binaire ». `validation.spec.ts` (doublure `ApiService`) : en-tête et totaux ; intégrité non vérifiée → raison affichée et boutons Récupérer / PR désactivés ; « Récupérer la branche » appelle `action(id, 'recuperation', {})` une fois (double clic) puis affiche le message ; PR → URL affichée en texte ; erreur 409 affichée ; renvoi : « Renvoyer » désactivé si vide, appelle `action(id, 'renvoi', { commentaire })` ; abandon : confirmation puis `action(id, 'abandon', {})`, « Annuler » n'appelle rien. `bureau.spec.ts` : listes, liens, état vide, pastille dans `app.spec.ts`.

Run: `npm run test:web` — Expected: FAIL.

- [ ] **Step 2: Implémentation** selon le comportement (gabarits en ligne, signaux, interpolation seule, `commandeVisible` importé de `web/src/app/commande-visible.ts`). Route `{ path: 'bureau', component: Bureau }` avant `'**'`.

- [ ] **Step 3: Vérifier.** `npm run test:web`, `npm run web:build` (sans avertissement).

- [ ] **Step 4: Commit** — `git add web && git commit -m "Panneau : Mon bureau, boîte de validation (diff, rapports, avis, journal), récupération, PR, renvoi, abandon"`

---

### Task 6: Tâche bloquée et alerte d'intégrité

**Files:**
- Create: `web/src/app/tache/blocage.ts`, `web/src/app/tache/alerte.ts` et leurs specs
- Modify: `web/src/app/tache/tache.ts`

**Interfaces:**
- Consumes: `ApiService.historique(id)`, `ApiService.action(id, 'relance' | 'reprise' | 'abandon', corps)`.
- Produces: `BlocageVue` et `AlerteVue` (`input.required<Tache>()`), affichées par `TacheVue` à la place des blocs « reprise » de 2c pour ces états.

Comportement :
- `TacheVue`, statut `bloquee` → `BlocageVue` :
  - titre « Mon bureau · Tâche bloquée », `{id} · {projet}`, titre, `{essaisQa} no-go · {budget()}` ;
  - « Résumé du blocage » : `raison` de la tâche, puis, depuis la dernière entrée d'historique, les règles déclenchées et les critères non remplis (`C{numero} · Preuve : {preuve}`) ;
  - « Historique des {n} essais » : pour chaque entrée, date `heure()`, `GO`/`NO-GO`, règles ;
  - texte « Le dossier complet (spec, plan, diffs, rapports, verdicts, journal) reste dans le bureau. Rien n'a touché le repo {projet}. » ;
  - boutons « Relancer » (`reprise {}`), « Reprendre le cadrage » (`relance { vers: 'cadrage' }`), « Relancer avec commentaire » (dialogue : zone de texte, « Annuler », « Relancer » désactivé si vide → `relance { vers: 'implementation', commentaire }`), « Abandonner » (même confirmation que la tâche 5).
- `TacheVue`, statut `en_pause` et raison commençant par `integrite` → `AlerteVue` :
  - titre « Poste de sécurité · Alerte d'intégrité », `{id} · {projet}`, titre, `Étape {LIBELLE_ETAPE} · tâche en pause` ;
  - la raison complète (après `integrite : `) dans un bloc mis en évidence ;
  - boutons « Reprendre » (`reprise {}`), « Compter comme no-go et relancer » (`relance { vers: 'implementation' }`), « Abandonner la tâche » (confirmation) ;
  - texte « Quelle que soit ta décision, elle est consignée dans le journal des commandes. ».
- Toute action : boutons désactivés pendant l'appel, erreur 409 affichée, fiche rechargée après succès.

- [ ] **Step 1: Tests qui échouent.** `blocage.spec.ts` : résumé (raison + règles + critères non remplis de la dernière entrée) ; historique dans l'ordre reçu ; chaque bouton appelle la bonne action avec le bon corps ; « Relancer » du dialogue désactivé si vide ; confirmation d'abandon ; texte venant des verdicts rendu en texte (`<script>` non interprété). `alerte.spec.ts` : raison affichée sans le préfixe `integrite : ` ; trois boutons et leurs actions ; confirmation d'abandon. `tache.spec.ts` : `bloquee` affiche `BlocageVue`, `en_pause` intégrité affiche `AlerteVue`, `en_pause` budget garde le bloc budget de 2c, `en_pause` escalade garde le lien vers le poste de sécurité.

Run: `npm run test:web` — Expected: FAIL.

- [ ] **Step 2: Implémentation** selon le comportement.

- [ ] **Step 3: Vérifier.** `npm run test:web`, `npm run web:build`.

- [ ] **Step 4: Commit** — `git add web && git commit -m "Panneau : tâche bloquée (résumé, historique, relances) et alerte d'intégrité"`

---

### Task 7: Documentation et vérification de bout en bout

**Files:**
- Modify: `CLAUDE.md` (section Commandes seulement), `README.md`

- [ ] **Step 1: Documentation.** `CLAUDE.md`, section Commandes, ajouter : « Fin de tâche : récupérer la branche importe `task/<n>` dans le dépôt relié (bundle vérifié, sans hooks, jamais forcé) ; « Ouvrir une PR » lance `git push` et `gh pr create` sur l'hôte avec tes identifiants. Les volumes d'une tâche terminée ou abandonnée sont supprimés. » ; et la note : « Un dossier de données temporaire (`BUREAU_DONNEES`) demande son propre `npm run image` (le manifeste signé y est écrit). » `README.md` : une ligne équivalente dans la procédure.

- [ ] **Step 2: Vérification complète.** `npm test`, `npm run typecheck`, `npm run test:web`, `npm run web:build`, `test-docker/validation.test.ts` et `test-docker/pipeline.test.ts` (`--test-concurrency=1 --test-timeout=1800000`). Puis démarrage réel (dossier de données temporaire, `npm run image` avec le même `BUREAU_DONNEES`, sans clé API) : `GET /api/taches/T-999/validation` avec le jeton → 409 ; `POST /api/taches/T-999/relance` `{ "vers": "autre" }` → 400. Arrêter le processus lancé (par son PID), supprimer le dossier temporaire et les volumes créés.

- [ ] **Step 3: Commit** — `git commit -am "Documentation : fin de tâche (branche, PR, volumes)"`

---

## Annexe A — Textes de la maquette repris

Boîte de validation : « Mon bureau · Boîte de validation », « {id} · {projet} », « task/41 · 6 commits · +163 −12 », « ✓ Intégrité vérifiée », « Verdict QA : GO », « Couverture du code modifié », « Failles par sévérité », « Note critique non bloquante · Patron · d'après le diff et les rapports », « 214 commandes », « 2 refus », « 0 escalade », « Annuler », « Renvoyer », « Récupérer la branche », « Ouvrir une PR », « Renvoyer avec commentaire », « Abandonner ».
Tâche bloquée : « Mon bureau · Tâche bloquée », « 3 no-go · 5,90 $ / 6,00 $ », « Résumé du blocage », « Historique des 3 essais », « Rien n'a touché le repo Film. », « Annuler », « Relancer », « Reprendre le cadrage », « Relancer avec commentaire », « Abandonner ».
Alerte d'intégrité : « Poste de sécurité · Alerte d'intégrité », « Étape QA · tâche en pause », « Compter comme no-go et relancer », « Abandonner la tâche ». (« Restaurer la version validée » non repris : choix 3.)

## Reporté

- Écran Réglages (modèles par agent, seuils par défaut), notifications, conteneurs en cours.
- Phase 4 : carte Phaser, mini-carte, avatars.
