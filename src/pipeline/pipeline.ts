import {
  agentPour, DEFINITIONS, lireSortie, SortieCadreur, SortieImplementeur, SortiePatronCode, SortiePatronPlan, SortieQa, SortieReviewer,
  type EtapeAgent,
} from '../agents/definitions.ts';
import type { Config } from '../config.ts';
import type { Agent, ResultatEtape } from '../conteneurs/execution.ts';
import type { Base } from '../db.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
import { enregistrerArtefact, lireArtefact } from '../integrite/artefacts.ts';
import { ajouterAuJournal, lireJournal } from '../integrite/journal.ts';
import { ajouterDepense, appliquer, definirAgent, definirReprise, lireTache, type Tache } from '../taches/depot.ts';
import { ajouterEchange, enregistrerProposition } from '../taches/echanges.ts';
import type { Controle, DemandeControle } from './controleur.ts';
import { documentsEtape, extraireCriteres, lireCriteres, promptEtape } from './prompts.ts';
import type { Analyse } from '../analyse/analyse.ts';
import { reglesQa } from '../analyse/regles.ts';
import { lireSeuils } from '../taches/seuils.ts';
import type { z } from 'zod';

export type DepsPipeline = {
  db: Base; cle: Buffer; config: Config; racineDepot: string;
  executer: (tacheId: string, agent: Agent, prompt: string, options: { volume?: string }) => Promise<ResultatEtape>;
  copie: (tacheId: string, neuve: boolean) => Promise<string>;
  supprimerCopie: (tacheId: string) => Promise<void>;
  controler: (d: DemandeControle) => Promise<Controle>;
  /** Lecture d'un fichier dans un volume (la copie de contrôle du cadreur), avant sa suppression. */
  lireFichier: (volume: string, chemin: string) => Promise<string | null>;
  /** Mesures de l'orchestrateur sur la copie de contrôle (tests, couverture, audits, Semgrep, gitleaks). */
  analyser: (tacheId: string, volume: string, base: string) => Promise<Analyse>;
  /** SHA du commit de la branche dans la copie ; null si illisible. */
  shaCopie: (volume: string) => Promise<string | null>;
};

const SHA_VALIDE = /^[0-9a-f]{40}$/;

function lireAnalyse(db: Base, cle: Buffer, tacheId: string): Analyse {
  const a = lireArtefact(db, cle, tacheId, 'analyse');
  if (!a) throw new AnomalieIntegrite('analyse', 'document manquant : analyse');
  return JSON.parse(a.contenu) as Analyse;
}

export const RELAIS: Partial<Record<EtapeAgent, string>> = {
  patron_plan: 'Cadrage → Patron (plan)',
  implementation: 'Patron (plan) → Implémentation',
  review: 'Implémentation → Review',
  patron_code: 'Review → Patron (code)',
  qa: 'Patron (code) → QA',
};

function signaler(deps: DepsPipeline, tacheId: string, raison: 'integrite' | 'erreur_api', detail: string): Tache {
  // Après une anomalie, aucune session n'est reprise telle quelle : la reprise humaine relance l'étape à neuf.
  if (raison === 'integrite') definirReprise(deps.db, tacheId, null);
  const t = appliquer(deps.db, tacheId, { type: 'pause', raison, detail });
  ajouterAuJournal(deps.db, deps.cle, {
    tacheId, type: 'evenement', commande: 'contrôle du relais', couche: '—', decision: 'Refusé',
    decideur: raison === 'integrite' ? 'Contrôleur d’intégrité' : 'Orchestrateur', raison: detail,
  });
  return t;
}

export async function avancer(deps: DepsPipeline, tacheId: string): Promise<Tache> {
  const { db, cle } = deps;
  const tache = lireTache(db, tacheId);
  if (tache.statut !== 'prete' || tache.etape === 'validation') return tache;
  const etape = tache.etape as EtapeAgent;
  const def = DEFINITIONS[etape];

  let prompt: string;
  let criteresQa: string[] = [];
  try {
    prompt = promptEtape(db, cle, tache);
    if (etape === 'qa') criteresQa = lireCriteres(lireArtefact(db, cle, tacheId, 'criteres')?.contenu ?? '');
    const relais = RELAIS[etape];
    if (relais && tache.reprise === null) {
      const c = await deps.controler({
        tache: { id: tache.id, titre: tache.titre }, relais,
        criteresValides: lireCriteres(lireArtefact(db, cle, tacheId, 'criteres')?.contenu ?? ''),
        documents: documentsEtape(db, cle, tache),
        journal: lireJournal(db, tacheId).slice(-50).map(e => ({ commande: e.commande, decision: e.decision, raison: e.raison })),
      });
      if (c.coutUsd > 0) ajouterDepense(db, tacheId, c.coutUsd);
      if (c.verdict === 'signaler') return signaler(deps, tacheId, 'integrite', `contrôleur d’intégrité : ${(c.constats.join(' ; ') || 'signalement sans détail')}`);
      if (c.verdict === 'indisponible') return signaler(deps, tacheId, 'erreur_api', c.constats.join(' ; ') || 'contrôleur d’intégrité indisponible');
    }
  } catch (e) {
    if (!(e instanceof AnomalieIntegrite)) throw e;
    return signaler(deps, tacheId, 'integrite', e.message);
  }

  definirAgent(db, tacheId, def.agent);
  let volume: string | undefined;
  const fin = async (): Promise<Tache> => {
    if (volume && lireTache(db, tacheId).statut !== 'en_pause') await deps.supprimerCopie(tacheId);
    definirAgent(db, tacheId, null);
    return lireTache(db, tacheId);
  };
  try {
    volume = def.espace === 'copie' ? await deps.copie(tacheId, tache.reprise === null) : undefined;
    if (etape === 'review') {
      if (!tache.commitBase) {
        // Tâche encore prête : la machine à états n'accepte « bloquee » que depuis en_cours.
        appliquer(db, tacheId, { type: 'demarrage' });
        appliquer(db, tacheId, { type: 'bloquee', detail: 'commit de base inconnu : tâche créée avant l’analyse' });
        return fin();
      }
      // Mesures prises sur la copie de contrôle fraîche, avant le reviewer.
      const analyse = await deps.analyser(tacheId, volume!, tache.commitBase);
      enregistrerArtefact(db, cle, tacheId, 'analyse', JSON.stringify(analyse, null, 2));
      prompt = promptEtape(db, cle, lireTache(db, tacheId));
    }
    if (etape === 'qa') {
      const analyse = lireAnalyse(db, cle, tacheId);
      // Sha d'analyse invalide : les mesures statiques sont déjà forcées absentes, donc no-go par les règles, sans fausse anomalie.
      if (SHA_VALIDE.test(analyse.sha) && (await deps.shaCopie(volume!)) !== analyse.sha)
        throw new AnomalieIntegrite('analyse', 'la branche a changé depuis l’analyse de review');
    }
    const r = await deps.executer(tacheId, agentPour(etape, deps.config, deps.racineDepot), prompt, { volume });
    if (r.issue !== 'terminee') return fin();

    const illisible = () => appliquer(db, tacheId, { type: 'bloquee', detail: 'sortie de l’agent illisible : étape à relancer' });
    const lire = <T>(s: z.ZodType<T>) => lireSortie(s, r.sortie);
    let t: Tache;
    switch (etape) {
      case 'cadrage': {
        const s = lire(SortieCadreur);
        if (!s) { t = illisible(); break; }
        if (s.type === 'questions') {
          ajouterEchange(db, tacheId, 'cadreur', (s.questions ?? []).join('\n'));
          t = appliquer(db, tacheId, { type: 'etape_terminee', verdict: 'questions' });
        } else {
          // Copie non signée des fichiers du cadreur, lue dans SA copie de contrôle avant suppression : c'est elle que je valide.
          if (!volume) throw new Error('cadrage sans copie de contrôle');
          const spec = (await deps.lireFichier(volume, '/workspace/cadrage/spec.md'))?.trim() ?? '';
          const plan = (await deps.lireFichier(volume, '/workspace/cadrage/plan.md'))?.trim() ?? '';
          const criteres = extraireCriteres(spec);
          if (!spec || !plan || !criteres.length) {
            t = appliquer(db, tacheId, { type: 'bloquee', detail: 'documents du cadreur incomplets : spec.md avec critères numérotés et plan.md attendus' });
            break;
          }
          enregistrerProposition(db, tacheId, { spec: `${spec}\n`, criteres, plan: `${plan}\n` });
          t = appliquer(db, tacheId, { type: 'etape_terminee', verdict: 'proposition' });
        }
        break;
      }
      case 'patron_plan': {
        const s = lire(SortiePatronPlan);
        if (!s) { t = illisible(); break; }
        enregistrerArtefact(db, cle, tacheId, 'avis_patron', s.note);
        t = appliquer(db, tacheId, { type: 'etape_terminee', verdict: s.verdict });
        break;
      }
      case 'implementation': {
        const s = lire(SortieImplementeur);
        if (!s) { t = illisible(); break; }
        enregistrerArtefact(db, cle, tacheId, 'resume', s.resume);
        t = appliquer(db, tacheId, { type: 'etape_terminee' });
        break;
      }
      case 'review': {
        const s = lire(SortieReviewer);
        if (!s) { t = illisible(); break; }
        enregistrerArtefact(db, cle, tacheId, 'rapport', s.rapport);
        t = appliquer(db, tacheId, { type: 'etape_terminee' });
        break;
      }
      case 'patron_code': {
        const s = lire(SortiePatronCode);
        if (!s) { t = illisible(); break; }
        enregistrerArtefact(db, cle, tacheId, 'avis_patron_code', s.note);
        t = appliquer(db, tacheId, { type: 'etape_terminee' });
        break;
      }
      case 'qa': {
        const s = lire(SortieQa);
        if (!s) { t = illisible(); break; }
        // Relecture vérifiée après l'agent : une altération pendant l'étape lève AnomalieIntegrite (pause, via le catch).
        criteresQa = lireCriteres(lireArtefact(db, cle, tacheId, 'criteres')?.contenu ?? '');
        const seuils = lireSeuils(db, tache.projet, deps.config.seuilCouvertureLignes);
        const r = reglesQa(lireAnalyse(db, cle, tacheId), seuils, s, criteresQa);
        enregistrerArtefact(db, cle, tacheId, 'verdict', JSON.stringify({ qa: s, regles: r.declenchees, verdict: r.verdict }, null, 2));
        t = appliquer(db, tacheId, { type: 'etape_terminee', verdict: r.verdict });
        break;
      }
    }
    return fin();

  } catch (e) {
    const courante = lireTache(db, tacheId);
    if (courante.statut === 'en_cours' || courante.statut === 'prete') {
      if (e instanceof AnomalieIntegrite) signaler(deps, tacheId, 'integrite', e.message);
      else signaler(deps, tacheId, 'erreur_api', (e instanceof Error ? e.message : String(e)).slice(0, 200));
    }
    return await fin();
  } finally {
    definirAgent(db, tacheId, null);
  }
}
