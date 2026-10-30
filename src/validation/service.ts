import { brancheTache, nomRessource } from '../conteneurs/docker.ts';
import type { FichierModifie, LectureValidation } from '../conteneurs/validation.ts';
import type { Base } from '../db.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
import { lireArtefact, listerArtefacts, verifierArtefactsTache } from '../integrite/artefacts.ts';
import { ajouterAuJournal, lireJournal } from '../integrite/journal.ts';
import { lireAnalyse } from '../pipeline/pipeline.ts';
import { lireCriteres } from '../pipeline/prompts.ts';
import { appliquer, lireTache, type Tache } from '../taches/depot.ts';
import { importerBranche, ouvrirPr, type Executer } from './depot-hote.ts';

export type DepsValidation = {
  db: Base; cle: Buffer;
  lire: (volume: string, base: string, sha: string) => Promise<LectureValidation | null>;
  bundle: (volume: string, tacheId: string, base: string, sha: string) => Promise<Buffer | null>;
  executer: Executer;
  supprimerVolumes: (tacheId: string) => Promise<void>;
};

export type DossierValidation = {
  branche: string; sha: string; commits: number; fichiers: FichierModifie[]; diff: string; tronque: boolean;
  integrite: { verifiee: true } | { verifiee: false; raison: string };
  journal: { commandes: number; refus: number; escalades: number };
};

export type VersionVerdict = { creeLe: string; verdict: 'go' | 'no_go'; regles: string[]; criteresNonRemplis: { numero: number; preuve: string }[] };

type VerdictSigne = { qa: { verdict: 'go' | 'no_go'; criteres: { numero: number; rempli: boolean; preuve: string }[] }; regles: string[]; verdict: 'go' | 'no_go' };

const raisonCourte = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

function refuser(deps: DepsValidation, tacheId: string, commande: string, decideur: string, raison: string): void {
  ajouterAuJournal(deps.db, deps.cle, { tacheId, type: 'decision', commande, couche: '—', decision: 'Refusé', decideur, raison: raison.slice(0, 200) });
}
const autoriser = (deps: DepsValidation, tacheId: string, commande: string, raison: string) =>
  ajouterAuJournal(deps.db, deps.cle, { tacheId, type: 'decision', commande, couche: 'humain', decision: 'Autorisé', decideur: 'Moi', raison });

function tacheEnValidation(db: Base, tacheId: string): Tache {
  const t = lireTache(db, tacheId);
  if (t.etape !== 'validation' || t.statut !== 'attente_humain') throw new Error(`${tacheId} n’attend pas ma validation`);
  return t;
}

export async function dossierValidation(deps: DepsValidation, tacheId: string): Promise<DossierValidation> {
  const { db, cle } = deps;
  const t = tacheEnValidation(db, tacheId);
  const { sha } = lireAnalyse(db, cle, tacheId);
  if (!t.commitBase) throw new Error('commit de base inconnu : lecture de la branche impossible');
  const lecture = await deps.lire(nomRessource(tacheId), t.commitBase, sha);
  if (!lecture) throw new Error('lecture de la branche impossible');

  let integrite: DossierValidation['integrite'] = { verifiee: true };
  if (lecture.pointe !== sha) {
    const raison = `la branche a changé depuis l’analyse (pointe ${lecture.pointe.slice(0, 7)} au lieu de ${sha.slice(0, 7)})`;
    integrite = { verifiee: false, raison };
    ajouterAuJournal(db, cle, {
      tacheId, type: 'evenement', commande: 'contrôle de la branche avant validation', couche: '—', decision: 'Refusé', decideur: 'Contrôleur d’intégrité', raison,
    });
  } else {
    try {
      verifierArtefactsTache(db, cle, tacheId);
    } catch (e) {
      if (!(e instanceof AnomalieIntegrite)) throw e;
      integrite = { verifiee: false, raison: e.message };
    }
  }

  const decisions = lireJournal(db, tacheId).filter(e => e.type === 'decision');
  const escalades = (db.prepare('SELECT COUNT(*) AS n FROM escalades WHERE tache_id = ?').get(tacheId) as { n: number }).n;
  return {
    branche: brancheTache(tacheId), sha, commits: lecture.commits, fichiers: lecture.fichiers, diff: lecture.diff, tronque: lecture.tronque,
    integrite,
    journal: { commandes: decisions.length, refus: decisions.filter(e => e.decision === 'Refusé').length, escalades },
  };
}

// Bundle vérifié puis import dans mon dépôt ; tout refus est journalisé avant d'être remonté. Aucune transition ici.
async function importer(deps: DepsValidation, tacheId: string): Promise<{ tache: Tache; branche: string; sha: string }> {
  const tache = tacheEnValidation(deps.db, tacheId);
  const branche = brancheTache(tacheId);
  const commande = `git fetch <bundle> ${branche} → ${tache.cheminProjet}`;
  try {
    const dossier = await dossierValidation(deps, tacheId);
    if (!dossier.integrite.verifiee) throw new Error(`récupération refusée : ${dossier.integrite.raison}`);
    const bundle = await deps.bundle(nomRessource(tacheId), tacheId, tache.commitBase!, dossier.sha);
    if (!bundle) throw new Error('bundle de la branche impossible (pointe changée, branche vide ou trop volumineuse)');
    const issue = await importerBranche(deps.executer, tache.cheminProjet, bundle, branche, dossier.sha);
    autoriser(deps, tacheId, commande, `${issue === 'importee' ? 'branche récupérée' : 'branche déjà présente'} (${dossier.sha.slice(0, 7)})`);
    return { tache, branche, sha: dossier.sha };
  } catch (e) {
    refuser(deps, tacheId, commande, 'Orchestrateur', raisonCourte(e));
    throw e;
  }
}

// La tâche est terminée : un volume qui résiste est journalisé, jamais remonté.
async function nettoyer(deps: DepsValidation, tacheId: string): Promise<void> {
  try {
    await deps.supprimerVolumes(tacheId);
  } catch (e) {
    ajouterAuJournal(deps.db, deps.cle, {
      tacheId, type: 'evenement', commande: 'suppression des volumes de la tâche', couche: '—', decision: 'Erreur', decideur: 'Orchestrateur', raison: raisonCourte(e),
    });
  }
}

export async function recupererBranche(deps: DepsValidation, tacheId: string): Promise<Tache> {
  await importer(deps, tacheId);
  const t = appliquer(deps.db, tacheId, { type: 'validation', decision: 'branche' });
  await nettoyer(deps, tacheId);
  return t;
}

function lireVerdict(contenu: string): VerdictSigne {
  let v: unknown;
  try { v = JSON.parse(contenu); } catch { throw new AnomalieIntegrite('verdict', 'verdict illisible : JSON invalide'); }
  const o = v as Partial<VerdictSigne> | null;
  if (typeof o !== 'object' || o === null || (o.verdict !== 'go' && o.verdict !== 'no_go') || !Array.isArray(o.regles)
    || typeof o.qa !== 'object' || o.qa === null || !Array.isArray(o.qa.criteres))
    throw new AnomalieIntegrite('verdict', 'verdict illisible : forme inattendue');
  return o as VerdictSigne;
}

function corpsPr(deps: DepsValidation, tacheId: string): string {
  const criteres = lireArtefact(deps.db, deps.cle, tacheId, 'criteres')?.contenu ?? '';
  const signe = lireArtefact(deps.db, deps.cle, tacheId, 'verdict');
  if (!signe) throw new AnomalieIntegrite('verdict', 'document manquant : verdict');
  const v = lireVerdict(signe.contenu);
  const total = lireCriteres(criteres).length;
  const remplis = new Set(v.qa.criteres.filter(c => c.rempli && c.numero >= 1 && c.numero <= total).map(c => c.numero)).size;
  return `## Critères d'acceptation\n\n${criteres.trim()}\n\n## Verdict QA\n\n${v.verdict === 'go' ? 'GO' : 'NO-GO'}, ${remplis} critères remplis sur ${total}`;
}

export async function ouvrirPullRequest(deps: DepsValidation, tacheId: string): Promise<{ tache: Tache; url: string }> {
  const { tache, branche } = await importer(deps, tacheId);
  let url: string;
  try {
    url = await ouvrirPr(deps.executer, tache.cheminProjet, branche, `${tacheId} · ${tache.titre}`, corpsPr(deps, tacheId));
  } catch (e) {
    const erreur = new Error(`branche récupérée dans ton dépôt ; PR impossible : ${e instanceof Error ? e.message : String(e)}`);
    refuser(deps, tacheId, 'gh pr create', 'Orchestrateur', erreur.message);
    throw erreur;
  }
  autoriser(deps, tacheId, 'gh pr create', url);
  const t = appliquer(deps.db, tacheId, { type: 'validation', decision: 'pr' });
  await nettoyer(deps, tacheId);
  return { tache: t, url };
}

export function historique(deps: DepsValidation, tacheId: string): VersionVerdict[] {
  return listerArtefacts(deps.db, deps.cle, tacheId, 'verdict').reverse().map(a => {
    const v = lireVerdict(a.contenu);
    return {
      creeLe: a.creeLe, verdict: v.verdict, regles: v.regles,
      criteresNonRemplis: v.qa.criteres.filter(c => !c.rempli).map(c => ({ numero: c.numero, preuve: c.preuve })),
    };
  });
}
