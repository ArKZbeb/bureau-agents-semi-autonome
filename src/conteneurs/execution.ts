import type Docker from 'dockerode';
import type { EventEmitter } from 'node:events';
import type { Config } from '../config.ts';
import type { Base } from '../db.ts';
import { descriptionAppel } from '../gardien/service.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
import { verifierArtefactsTache } from '../integrite/artefacts.ts';
import { ajouterAuJournal, verifierJournal } from '../integrite/journal.ts';
import { verifierManifeste } from '../integrite/manifeste.ts';
import { sha256 } from '../integrite/signature.ts';
import type { Jetons } from '../reseau/jetons.ts';
import { appliquer, definirReprise, lireTache, type Reprise } from '../taches/depot.ts';
import type { RaisonPause } from '../taches/etats.ts';
import {
  creerConteneurAgent, DOSSIER_ETAT, executerDans, fichierParametresVides, lireFichierVolume, nomRessource, PORT_INTERNE_PASSERELLE, preparerReseau, RACINE_PROJET,
  supprimerReseau, verifierImage,
} from './docker.ts';
import { decoupeurLignes, lireLigne, type Fin } from './flux.ts';

export type Agent = { nom: string; modele: string; maxTours: number; dureeMaxMs: number; promptSysteme: string };
export type ResultatEtape = { issue: 'terminee'; resultat: string } | { issue: 'pause'; raison: RaisonPause } | { issue: 'bloquee'; raison: string };
export type DepsExecution = {
  docker: Docker; db: Base; cle: Buffer; jetons: Jetons; evenements: EventEmitter; config: Config; racineDepot: string;
  enCours: Map<string, Docker.Container>;
  surOutil?: (tacheId: string, conteneur: Docker.Container) => void;
};
type Suivi = { fin: Fin | null; sessionId: string | null; outils: Set<string>; resultats: Set<string>; expire: boolean };

export const cheminTranscript = (sessionId: string) => `${DOSSIER_ETAT}/projects/${RACINE_PROJET.replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}.jsonl`;
const REPRENDRE = 'Reprends la tâche là où tu t’étais arrêté.';

function pauseIntegrite(deps: DepsExecution, tacheId: string, message: string): ResultatEtape {
  definirReprise(deps.db, tacheId, null);
  appliquer(deps.db, tacheId, { type: 'pause', raison: 'integrite', detail: message });
  ajouterAuJournal(deps.db, deps.cle, { tacheId, type: 'evenement', commande: 'contrôle d’intégrité', couche: '—', decision: 'Refusé', decideur: 'Contrôleur d’intégrité', raison: message });
  return { issue: 'pause', raison: 'integrite' };
}

function messageEscalade(db: Base, tacheId: string): string {
  const e = db.prepare(`SELECT outil, entree, statut, commentaire FROM escalades WHERE tache_id = ? AND statut != 'en_attente' ORDER BY id DESC LIMIT 1`)
    .get(tacheId) as { outil: string; entree: string; statut: string; commentaire: string | null } | undefined;
  if (!e) return REPRENDRE;
  const appel = descriptionAppel(e.outil, JSON.parse(e.entree) as Record<string, unknown>);
  return e.statut === 'approuvee'
    ? `J’ai approuvé : ${appel}. Relance exactement le même appel.`
    : `J’ai refusé : ${appel}${e.commentaire ? ` (${e.commentaire})` : ''}. Ne le relance pas ; trouve une autre approche conforme au plan, ou arrête-toi en expliquant le blocage.`;
}

export async function lancerEtape(deps: DepsExecution, tacheId: string, agent: Agent, prompt: string): Promise<ResultatEtape> {
  const tache = lireTache(deps.db, tacheId);
  if (tache.statut !== 'prete') throw new Error(`${tacheId} n’est pas prête (${tache.statut})`);
  if (deps.enCours.has(tacheId)) throw new Error(`${tacheId} a déjà une étape en cours`);
  const volume = nomRessource(tacheId);

  // Contrôles d'intégrité avant chaque étape : toute anomalie met la tâche en pause, sans conteneur.
  let imageId: string;
  try {
    imageId = verifierManifeste(deps.config.dossierDonnees, deps.cle, deps.racineDepot).image;
    await verifierImage(deps.docker, imageId);
    verifierArtefactsTache(deps.db, deps.cle, tacheId);
    verifierJournal(deps.db, deps.cle);
    if (tache.reprise) {
      const transcript = await lireFichierVolume(deps.docker, imageId, volume, cheminTranscript(tache.reprise.sessionId));
      if (sha256(transcript ?? '') !== tache.reprise.empreinteTranscript) throw new AnomalieIntegrite('transcript', 'transcript de session modifié pendant la pause');
    }
  } catch (e) {
    if (e instanceof AnomalieIntegrite) return pauseIntegrite(deps, tacheId, e.message);
    throw e;
  }

  const r = tache.reprise;
  const args = ['claude', '-p'];
  if (!r) args.push(prompt.trimStart().startsWith('-') ? `Consigne : ${prompt}` : prompt);
  else if (r.mode === 'message') args.push(r.message ?? messageEscalade(deps.db, tacheId));
  args.push('--output-format', 'stream-json', '--verbose', '--model', agent.modele, '--max-turns', String(agent.maxTours),
    '--permission-mode', 'default', '--append-system-prompt', agent.promptSysteme,
    // Réglages et serveurs MCP du dépôt ignorés : seuls comptent les managed settings et le fichier utilisateur vide.
    '--setting-sources', 'user', '--strict-mcp-config');
  if (r) args.push('--resume', r.sessionId);

  appliquer(deps.db, tacheId, { type: 'demarrage' });
  const jeton = deps.jetons.creer(tacheId, agent.dureeMaxMs + 10 * 60_000);
  const passerelle = `http://passerelle:${PORT_INTERNE_PASSERELLE}`;
  const proxy = `http://tache:${jeton}@passerelle:${PORT_INTERNE_PASSERELLE}`;
  const suivi: Suivi = { fin: null, sessionId: r?.sessionId ?? null, outils: new Set(), resultats: new Set(), expire: false };
  let conteneur: Docker.Container | undefined;
  let minuteur: NodeJS.Timeout | undefined;
  let minuteurEscalade: NodeJS.Timeout | undefined;
  let echec: string | null = null;
  // Si le defer est ignoré (appels parallèles), on coupe la session : la reprise se fera par message.
  const surEscalade = (id: string) => {
    if (id === tacheId) minuteurEscalade = setTimeout(() => { if (!suivi.fin) void conteneur?.remove({ force: true }).catch(() => {}); }, 5_000).unref();
  };
  deps.evenements.on('escalade', surEscalade);
  try {
    const reseau = await preparerReseau(deps.docker, tacheId);
    const c = await creerConteneurAgent(deps.docker, {
      tacheId, imageId, reseau, volume, ressources: deps.config.conteneur, parametresVides: fichierParametresVides(deps.config.dossierDonnees),
      // Aucun secret : ANTHROPIC_API_KEY porte le jeton de la tâche, que le proxy remplace par la vraie clé.
      env: [
        `ANTHROPIC_BASE_URL=${passerelle}`, `ANTHROPIC_API_KEY=${jeton}`, `BUREAU_JETON=${jeton}`,
        `HTTPS_PROXY=${proxy}`, `HTTP_PROXY=${proxy}`, `https_proxy=${proxy}`, `http_proxy=${proxy}`, 'NO_PROXY=passerelle', 'no_proxy=passerelle',
      ],
    });
    conteneur = c;
    deps.enCours.set(tacheId, c);
    minuteur = setTimeout(() => { suivi.expire = true; void c.remove({ force: true }).catch(() => {}); }, agent.dureeMaxMs);
    // Arrêt global pendant le démarrage du conteneur : on n'exécute rien.
    if (lireTache(deps.db, tacheId).statut === 'en_cours') await executerDans(c, args, decoupeurLignes(ligne => {
      for (const ev of lireLigne(ligne)) {
        if (ev.type === 'init') suivi.sessionId = ev.sessionId;
        else if (ev.type === 'outil') { suivi.outils.add(ev.id); deps.surOutil?.(tacheId, c); }
        else if (ev.type === 'resultat_outil') {
          suivi.resultats.add(ev.id);
          ajouterAuJournal(deps.db, deps.cle, {
            tacheId, type: 'sortie', outil: null, commande: 'sortie de l’outil', couche: '—', decision: ev.erreur ? 'Erreur' : 'Sortie',
            decideur: 'Conteneur', raison: ev.contenu.slice(0, 500), toolUseId: ev.id,
          });
        } else if (ev.type === 'fin') { suivi.fin = ev; suivi.sessionId = ev.sessionId; }
      }
    }));
  } catch (err) {
    echec = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  } finally {
    clearTimeout(minuteur);
    clearTimeout(minuteurEscalade);
    deps.evenements.off('escalade', surEscalade);
    deps.enCours.delete(tacheId);
    deps.jetons.revoquer(tacheId);
    await conteneur?.remove({ force: true }).catch(() => {});
    await supprimerReseau(deps.docker, tacheId);
  }
  if (echec !== null && lireTache(deps.db, tacheId).statut === 'en_cours') {
    const detail = `erreur d’exécution : ${echec}`;
    definirReprise(deps.db, tacheId, null);
    appliquer(deps.db, tacheId, { type: 'pause', raison: 'erreur_api', detail });
    ajouterAuJournal(deps.db, deps.cle, { tacheId, type: 'evenement', commande: 'exécution de l’étape', couche: '—', decision: 'Refusé', decideur: 'Orchestrateur', raison: detail });
    return { issue: 'pause', raison: 'erreur_api' };
  }
  return conclure(deps, tacheId, agent, imageId, volume, suivi);
}

async function conclure(deps: DepsExecution, tacheId: string, agent: Agent, imageId: string, volume: string, s: Suivi): Promise<ResultatEtape> {
  const tache = lireTache(deps.db, tacheId);
  // L'empreinte du transcript est prise conteneur arrêté : aucun processus de l'agent ne peut plus l'écrire.
  const reprise = async (mode: Reprise['mode'], message: string | null): Promise<void> => {
    if (!s.sessionId) return definirReprise(deps.db, tacheId, null);
    const transcript = await lireFichierVolume(deps.docker, imageId, volume, cheminTranscript(s.sessionId));
    definirReprise(deps.db, tacheId, { sessionId: s.sessionId, mode, message, empreinteTranscript: sha256(transcript ?? '') });
  };

  // Journal complet : tout appel exécuté ou refusé doit avoir sa décision du gardien.
  const sansDecision = [...s.outils].filter(id => s.resultats.has(id)
    && !deps.db.prepare(`SELECT 1 FROM journal WHERE type = 'decision' AND tool_use_id = ?`).get(id));
  if (sansDecision.length && tache.statut === 'en_cours')
    return pauseIntegrite(deps, tacheId, `journal incomplet : ${sansDecision.length} appel(s) sans décision du gardien`);

  if (tache.statut === 'en_pause') {
    const raison = (tache.raison ?? '').split(' : ')[0] as RaisonPause;
    if (raison === 'escalade') await reprise(s.fin?.stopReason === 'tool_deferred' ? 'defer' : 'message', null);
    else if (raison === 'integrite') definirReprise(deps.db, tacheId, null);
    else await reprise('message', REPRENDRE);
    return { issue: 'pause', raison };
  }
  if (s.expire) {
    definirReprise(deps.db, tacheId, null);
    appliquer(deps.db, tacheId, { type: 'bloquee', detail: `étape trop longue (plus de ${Math.round(agent.dureeMaxMs / 60_000)} min)` });
    return { issue: 'bloquee', raison: 'duree' };
  }
  if (tache.depenseUsd >= tache.budgetUsd) {
    await reprise('message', 'Le budget a été augmenté : reprends la tâche là où tu t’étais arrêté.');
    appliquer(deps.db, tacheId, { type: 'pause', raison: 'budget', detail: `Budget dépassé : ${tache.depenseUsd.toFixed(2)} $ / ${tache.budgetUsd.toFixed(2)} $` });
    return { issue: 'pause', raison: 'budget' };
  }
  if (s.fin?.sousType === 'error_max_turns') {
    definirReprise(deps.db, tacheId, null);
    appliquer(deps.db, tacheId, { type: 'bloquee', detail: `nombre maximal de tours atteint (${agent.maxTours})` });
    return { issue: 'bloquee', raison: 'tours' };
  }
  if (!s.fin || s.fin.erreur) {
    await reprise('message', REPRENDRE);
    const detail = s.fin ? `${s.fin.apiErrorStatus ?? 'erreur'} : ${s.fin.resultat.slice(0, 200)}` : 'Claude Code s’est arrêté sans résultat';
    appliquer(deps.db, tacheId, { type: 'pause', raison: 'erreur_api', detail });
    return { issue: 'pause', raison: 'erreur_api' };
  }
  definirReprise(deps.db, tacheId, null);
  return { issue: 'terminee', resultat: s.fin.resultat };
}
