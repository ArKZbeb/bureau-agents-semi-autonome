import path from 'node:path';
import type { Base } from '../db.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
import { lireArtefact } from '../integrite/artefacts.ts';
import { ajouterAuJournal, type Couche } from '../integrite/journal.ts';
import { sha256 } from '../integrite/signature.ts';
import { ajouterDepense, appliquer, lireTache, type Tache } from '../taches/depot.ts';
import type { Avis, DemandeAvis } from './avis.ts';
import { fichiersExecutes } from './commande.ts';
import { dependancesCommande, dependancesFichier, type Dependance, type Fiche } from './dependances.ts';
import { evaluerBash, evaluerContenu, evaluerFichier, zonesDuPlan, type VerdictDecide } from './regles.ts';

export const RACINE = '/workspace/projet';

export type EntreeHook = { tool_name: string; tool_input: Record<string, unknown>; tool_use_id?: string; session_id?: string };
export type SortieHook = {
  hookSpecificOutput: { hookEventName: 'PreToolUse'; permissionDecision: 'allow' | 'deny' | 'defer'; permissionDecisionReason: string };
};
export type DepsGardien = {
  db: Base; cle: Buffer;
  lireFichier: (tacheId: string, chemin: string) => Promise<string | null>;
  /** Chemin absolu après résolution des liens symboliques dans l'espace de la tâche ; null si impossible. */
  resoudreChemin: (tacheId: string, chemin: string) => Promise<string | null>;
  avis: (demande: DemandeAvis) => Promise<Avis>;
  fiche: (d: Dependance) => Promise<Fiche>;
  /** Tâche mise en pause par le gardien (escalade ou intégrité) : l'exécution arrête le conteneur. */
  surEscalade: (tacheId: string) => void;
};

type Decision = { decision: 'Autorisé' | 'Refusé' | 'Escaladé'; decideur: string; couche: Couche; raison: string };
type Contexte = { tacheId: string; titre: string; plan: string | null; zones: string[] };

export const OUTIL_SORTIE = 'StructuredOutput';
const OUTILS_INTERNES = new Set(['Task', 'Agent', 'TodoWrite', 'ToolSearch', 'Skill', 'TaskStop', OUTIL_SORTIE]);
const OUTILS_LECTURE = new Set(['Read', 'Glob', 'Grep', 'LS']);
const OUTILS_ECRITURE = new Set(['Write', 'Edit']);
const MAX_CONTENU = 20_000;
const SCRIPTS_NPM = /\bnpm\s+(run|run-script|test|start)\b/;
const SECRETS_MOTIF = /(^|[\/*])\.env|id_(rsa|ed25519|ecdsa|dsa)|\.ssh|\.aws|\.azure|\.git-credentials|\.netrc|\.(pem|pfx|p12|key)\b|secrets\.json/i;
const PAUSE = 'tâche en pause : rien ne passe tant que je n’ai pas décidé';

const enPause = (): Decision => ({ decision: 'Refusé', decideur: 'Orchestrateur', couche: '—', raison: PAUSE });
const refusListe = (raison: string): Decision => ({ decision: 'Refusé', decideur: 'Liste noire', couche: '2', raison });
const estChaine = (v: unknown): v is string => typeof v === 'string';
const enCours = (deps: DepsGardien, tacheId: string) => lireTache(deps.db, tacheId).statut === 'en_cours';

// Seuls les champs qui changent l'effet de l'appel comptent (la « description » d'un Bash peut varier).
function champsSignificatifs(outil: string, entree: Record<string, unknown>): unknown {
  if (outil === 'Bash') return [entree.command];
  if (outil === 'Write') return [entree.file_path, entree.content];
  if (outil === 'Edit') return [entree.file_path, entree.old_string, entree.new_string, entree.replace_all ?? false];
  return entree;
}
export const empreinteAppel = (outil: string, entree: Record<string, unknown>) => sha256(`${outil}\n${JSON.stringify(champsSignificatifs(outil, entree))}`);

// Une autorisation vaut pour un effet : le contenu des fichiers que l'appel exécute ou modifie y entre aussi.
async function empreinteEffective(deps: DepsGardien, tacheId: string, outil: string, entree: Record<string, unknown>): Promise<string> {
  const lus: [string, string | null][] = [];
  if (outil === 'Bash') {
    const commande = String(entree.command ?? '');
    for (const f of fichiersExecutes(commande)) {
      const chemin = path.posix.resolve(RACINE, f);
      lus.push([chemin, await deps.lireFichier(tacheId, chemin)]);
    }
    if (SCRIPTS_NPM.test(commande)) lus.push([`${RACINE}/package.json`, await deps.lireFichier(tacheId, `${RACINE}/package.json`)]);
  } else if (outil === 'Edit') {
    const chemin = path.posix.resolve(RACINE, String(entree.file_path));
    lus.push([chemin, await deps.lireFichier(tacheId, chemin)]);
  }
  return sha256(JSON.stringify([outil, champsSignificatifs(outil, entree), lus]));
}

export function descriptionAppel(outil: string, entree: Record<string, unknown>): string {
  if (outil === 'Bash') return String(entree.command ?? '');
  const chemin = entree.file_path ?? entree.path;
  const rel = typeof chemin === 'string' ? chemin.replace(`${RACINE}/`, '') : '';
  if (OUTILS_ECRITURE.has(outil)) return `écriture de ${rel}`;
  if (OUTILS_LECTURE.has(outil)) return `lecture de ${rel || entree.pattern || '.'}`;
  return outil;
}

const depuis = (v: VerdictDecide): Decision => ({ decision: v.decision, decideur: v.decideur, couche: '2', raison: v.raison });

export async function decider(deps: DepsGardien, tacheId: string, e: EntreeHook): Promise<SortieHook> {
  const outil = e.tool_name;
  const entree = e.tool_input ?? {};
  let d: Decision;
  let empreinte = '';
  try {
    d = await evaluer(deps, tacheId, outil, entree);
    if (d.decision === 'Escaladé') empreinte = await empreinteEffective(deps, tacheId, outil, entree);
  } catch (err) {
    d = { decision: 'Refusé', decideur: 'Gardien', couche: '—', raison: `erreur du gardien : ${(err as Error).message}` };
  }
  // Plus aucun await jusqu'à la pause : une escalade concurrente trouve la tâche déjà en pause et devient un refus.
  // Une escalade n'est créée que si la tâche tourne encore : sinon rien ne passe, et rien n'est enregistré.
  if (d.decision === 'Escaladé' && !enCours(deps, tacheId)) d = enPause();
  ajouterAuJournal(deps.db, deps.cle, {
    tacheId, type: 'decision', outil, commande: descriptionAppel(outil, entree), couche: d.couche,
    decision: d.decision, decideur: d.decideur, raison: d.raison, toolUseId: e.tool_use_id ?? null,
  });
  if (d.decision === 'Escaladé') {
    deps.db.prepare(`INSERT INTO escalades (tache_id, outil, entree, empreinte_appel, raison, statut, cree_le) VALUES (?, ?, ?, ?, ?, 'en_attente', ?)`)
      .run(tacheId, outil, JSON.stringify(entree), empreinte, d.raison, new Date().toISOString());
    appliquer(deps.db, tacheId, { type: 'pause', raison: 'escalade', detail: d.raison });
    deps.surEscalade(tacheId);
  }
  const permissionDecision = d.decision === 'Autorisé' ? 'allow' : d.decision === 'Refusé' ? 'deny' : 'defer';
  const raison = d.decision === 'Escaladé' ? `en attente de validation : ${d.raison}` : d.raison;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: raison } };
}

function entreeValide(outil: string, entree: Record<string, unknown>): boolean {
  if (outil === 'Bash') return typeof entree.command === 'string' && entree.command.trim() !== '';
  if (OUTILS_ECRITURE.has(outil)) return typeof entree.file_path === 'string';
  return true;
}

async function evaluer(deps: DepsGardien, tacheId: string, outil: string, entree: Record<string, unknown>): Promise<Decision> {
  const tache = lireTache(deps.db, tacheId);
  if (tache.statut !== 'en_cours') return enPause();
  if (!entreeValide(outil, entree)) return refusListe('appel invalide');

  // Plan d'abord : une altération arrête aussi les appels déjà approuvés.
  let plan: string | null;
  try {
    plan = lireArtefact(deps.db, deps.cle, tacheId, 'plan')?.contenu ?? null;
  } catch (err) {
    if (!(err instanceof AnomalieIntegrite)) throw err;
    appliquer(deps.db, tacheId, { type: 'pause', raison: 'integrite', detail: err.message });
    deps.surEscalade(tacheId); // même effet qu'une escalade : le conteneur en cours est arrêté
    return { decision: 'Refusé', decideur: 'Contrôleur d’intégrité', couche: '—', raison: err.message };
  }
  const ctx: Contexte = { tacheId, titre: tache.titre, plan, zones: zonesDuPlan(plan) };

  // Un lien du dépôt (src/x → ../.git/hooks/pre-commit) ne doit pas déguiser la cible réelle.
  const ecriture = OUTILS_ECRITURE.has(outil);
  const demande = path.posix.resolve(RACINE, String(ecriture ? entree.file_path : entree.file_path ?? entree.path ?? RACINE));
  let cible = demande;
  if (ecriture || OUTILS_LECTURE.has(outil)) {
    const resolu = await deps.resoudreChemin(tacheId, demande);
    if (resolu === null) return refusListe('chemin impossible à résoudre');
    if (ecriture && resolu !== demande) {
      const v = evaluerFichier(resolu, 'ecriture', RACINE, ctx.zones);
      return v.decision === 'Refusé' ? depuis(v) : refusListe('écriture via un lien symbolique');
    }
    cible = resolu;
  }

  const empreinte = await empreinteEffective(deps, tacheId, outil, entree);
  const auto = deps.db.prepare('SELECT decision FROM autorisations WHERE tache_id = ? AND empreinte_appel = ? AND utilisee = 0').get(tacheId, empreinte) as { decision: 'allow' | 'deny' } | undefined;
  if (auto) {
    deps.db.prepare('UPDATE autorisations SET utilisee = 1 WHERE tache_id = ? AND empreinte_appel = ?').run(tacheId, empreinte);
    return auto.decision === 'allow'
      ? { decision: 'Autorisé', decideur: 'Moi', couche: 'humain', raison: 'autorisation à usage unique après ma validation' }
      : { decision: 'Refusé', decideur: 'Moi', couche: 'humain', raison: 'refusé après examen : ne relance pas cet appel' };
  }

  if (outil === 'Bash') return evaluerAppelBash(deps, ctx, String(entree.command));
  if (OUTILS_ECRITURE.has(outil)) return evaluerEcriture(deps, ctx, outil, entree);
  if (outil === 'Glob' || outil === 'Grep') {
    const globs = (outil === 'Glob' ? [entree.pattern] : [entree.glob]).filter(estChaine);
    const cibles = [...globs, entree.path, entree.file_path].filter(estChaine);
    if (cibles.some(v => SECRETS_MOTIF.test(v))) return refusListe('accès à des fichiers de secrets');
    if (globs.some(g => g.startsWith('/') || g.startsWith('~') || g.includes('..'))) return refusListe('lecture hors du projet');
  }
  if (OUTILS_LECTURE.has(outil)) {
    const v = evaluerFichier(demande, 'lecture', RACINE, ctx.zones);
    return depuis(v.decision !== 'Autorisé' || cible === demande ? v : evaluerFichier(cible, 'lecture', RACINE, ctx.zones));
  }
  if (OUTILS_INTERNES.has(outil)) return { decision: 'Autorisé', decideur: 'Liste blanche', couche: '2', raison: 'outil interne de l’agent' };
  if (outil === 'WebFetch' || outil === 'WebSearch') return refusListe('accès web interdit');
  return refusListe(`outil non prévu : ${outil}`);
}

async function evaluerAppelBash(deps: DepsGardien, ctx: Contexte, commande: string): Promise<Decision> {
  const v = evaluerBash(commande, RACINE);
  if (v.suite === 'decide') return depuis(v);
  const contenus: Record<string, string> = {};
  for (const f of fichiersExecutes(commande)) {
    const chemin = path.posix.resolve(RACINE, f);
    const contenu = await deps.lireFichier(ctx.tacheId, chemin);
    if (contenu === null) continue;
    const danger = evaluerContenu(chemin, contenu, true);
    if (danger) return depuis(danger);
    contenus[chemin] = contenu.slice(0, MAX_CONTENU);
  }
  if (SCRIPTS_NPM.test(commande)) {
    const pj = await deps.lireFichier(ctx.tacheId, `${RACINE}/package.json`);
    if (pj) contenus[`${RACINE}/package.json`] = pj.slice(0, MAX_CONTENU);
  }
  return avecAvis(deps, ctx, { outil: 'Bash', entree: { command: commande } }, v.raison, dependancesCommande(commande), contenus);
}

// null = contenu avant illisible pour un Edit : la modification ne peut pas être contrôlée.
function contenuApres(outil: string, entree: Record<string, unknown>, avant: string | null): string | null {
  if (outil === 'Write') return String(entree.content ?? '');
  if (avant === null) return null;
  const ancien = String(entree.old_string ?? '');
  const nouveau = String(entree.new_string ?? '');
  return entree.replace_all ? avant.split(ancien).join(nouveau) : avant.replace(ancien, () => nouveau);
}

async function evaluerEcriture(deps: DepsGardien, ctx: Contexte, outil: string, entree: Record<string, unknown>): Promise<Decision> {
  const chemin = path.posix.resolve(RACINE, String(entree.file_path));
  const v = evaluerFichier(chemin, 'ecriture', RACINE, ctx.zones);
  if (v.decision !== 'Autorisé') return depuis(v);
  const avant = await deps.lireFichier(ctx.tacheId, chemin);
  const apres = contenuApres(outil, entree, avant);
  if (apres === null) return refusListe('fichier illisible : modification impossible à contrôler');
  const danger = evaluerContenu(chemin, apres);
  if (danger) return depuis(danger);
  const nouvelles = dependancesFichier(chemin, avant, apres);
  const appel = { outil, entree: { file_path: chemin } };
  if (nouvelles === null) return avecAvis(deps, ctx, appel, 'fichier de dépendances illisible', [], { [chemin]: apres.slice(0, MAX_CONTENU) });
  if (nouvelles.length) return avecAvis(deps, ctx, appel, `modification de ${path.posix.basename(chemin)}`, nouvelles, {});
  return depuis(v);
}

async function avecAvis(deps: DepsGardien, ctx: Contexte, appel: DemandeAvis['appel'], motif: string, dependances: Dependance[], contenus: Record<string, string>): Promise<Decision> {
  const fiches = await Promise.all(dependances.map(d => deps.fiche(d)));
  const absente = fiches.find(f => f.existe === false);
  if (absente) return { decision: 'Refusé', decideur: 'Gardien', couche: '3', raison: `paquet introuvable sur ${absente.ecosysteme} : ${absente.nom}` };
  if (!enCours(deps, ctx.tacheId)) return enPause();
  const avis = await deps.avis({
    tache: { id: ctx.tacheId, titre: ctx.titre }, plan: ctx.plan, appel,
    motif: dependances.length ? `nouvelle dépendance (${motif})` : motif, fiches, contenus,
  });
  if (avis.coutUsd > 0) ajouterDepense(deps.db, ctx.tacheId, avis.coutUsd);
  if (!enCours(deps, ctx.tacheId)) return enPause();
  const decision = avis.decision === 'autoriser' ? 'Autorisé' : avis.decision === 'refuser' ? 'Refusé' : 'Escaladé';
  return { decision, decideur: 'Gardien', couche: '3', raison: avis.raison };
}

type LigneEscalade = { id: number; tache_id: string; outil: string; entree: string; empreinte_appel: string; statut: string };

export function deciderEscalade(db: Base, cle: Buffer, id: number, decision: 'approuver' | 'refuser', commentaire: string): Tache {
  const esc = db.prepare('SELECT * FROM escalades WHERE id = ?').get(id) as LigneEscalade | undefined;
  if (!esc || esc.statut !== 'en_attente') throw new Error(`escalade ${id} introuvable ou déjà tranchée`);
  const tache = lireTache(db, esc.tache_id);
  if (tache.statut !== 'en_pause' || !tache.raison?.startsWith('escalade')) throw new Error('la tâche n’est pas en attente de cette escalade');
  const approuve = decision === 'approuver';
  db.prepare('UPDATE escalades SET statut = ?, commentaire = ?, decide_le = ? WHERE id = ?').run(approuve ? 'approuvee' : 'refusee', commentaire, new Date().toISOString(), id);
  db.prepare('INSERT INTO autorisations (tache_id, empreinte_appel, decision, escalade_id) VALUES (?, ?, ?, ?) ON CONFLICT (tache_id, empreinte_appel) DO UPDATE SET decision = excluded.decision, escalade_id = excluded.escalade_id, utilisee = 0')
    .run(esc.tache_id, esc.empreinte_appel, approuve ? 'allow' : 'deny', id);
  ajouterAuJournal(db, cle, {
    tacheId: esc.tache_id, type: 'decision', outil: esc.outil, commande: descriptionAppel(esc.outil, JSON.parse(esc.entree) as Record<string, unknown>),
    couche: 'humain', decision: approuve ? 'Autorisé' : 'Refusé', decideur: 'Moi', raison: commentaire || (approuve ? 'validé' : 'refusé'),
  });
  return appliquer(db, esc.tache_id, { type: 'reprise' });
}
