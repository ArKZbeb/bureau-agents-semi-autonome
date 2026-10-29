import { ajouterAuJournal } from '../integrite/journal.ts';
import { appliquer, listerTaches, lireTache, type Tache } from '../taches/depot.ts';
import { avancer as avancerParDefaut, type DepsPipeline } from './pipeline.ts';

export type OptionsOrdonnanceur = { simultanees: number; intervalleMs: number; delaisErreurApiMs: number[]; horloge?: () => number };
type Avancer = (deps: DepsPipeline, tacheId: string) => Promise<Tache>;

const estErreurApi = (t: Tache) => t.statut === 'en_pause' && (t.raison ?? '').startsWith('erreur_api');

export function creerOrdonnanceur(deps: DepsPipeline, o: OptionsOrdonnanceur, avancer: Avancer = avancerParDefaut) {
  const horloge = o.horloge ?? Date.now;
  const enVol = new Map<string, Promise<void>>();
  const tentatives = new Map<string, { n: number; depuis: number; epuise: boolean }>();
  let minuteur: NodeJS.Timeout | undefined;
  let enTour = false;

  const lancer = (id: string) => {
    const p = avancer(deps, id).then(() => {}, (e: unknown) => {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      const t = lireTache(deps.db, id);
      if (t.statut === 'en_cours' || t.statut === 'prete') appliquer(deps.db, id, { type: 'pause', raison: 'erreur_api', detail: message });
      ajouterAuJournal(deps.db, deps.cle, { tacheId: id, type: 'evenement', commande: 'exécution de l’étape', couche: '—', decision: 'Refusé', decideur: 'Orchestrateur', raison: message });
    }).finally(() => enVol.delete(id));
    enVol.set(id, p);
  };

  const tour = async () => {
    if (enTour) return;
    enTour = true;
    try {
      const maintenant = horloge();
      for (const t of listerTaches(deps.db)) {
        // Le compteur vit tant que la tâche peut encore être relancée (y compris pendant une relance en cours).
        if (!estErreurApi(t)) { if (!['prete', 'en_cours'].includes(t.statut)) tentatives.delete(t.id); continue; }
        const suivi = tentatives.get(t.id) ?? { n: 0, depuis: maintenant, epuise: false };
        tentatives.set(t.id, suivi);
        if (suivi.epuise) continue;
        if (suivi.n >= o.delaisErreurApiMs.length) {
          suivi.epuise = true;
          ajouterAuJournal(deps.db, deps.cle, { tacheId: t.id, type: 'evenement', commande: 'nouvelle tentative', couche: '—', decision: 'Refusé', decideur: 'Orchestrateur', raison: 'nouvelles tentatives épuisées : à reprendre à la main' });
          continue;
        }
        if (maintenant - suivi.depuis >= o.delaisErreurApiMs[suivi.n]) {
          tentatives.set(t.id, { n: suivi.n + 1, depuis: maintenant, epuise: false });
          appliquer(deps.db, t.id, { type: 'reprise' });
        }
      }
      for (const t of listerTaches(deps.db)) {
        if (enVol.size >= o.simultanees) break;
        if (t.statut === 'prete' && t.etape !== 'validation' && !enVol.has(t.id)) lancer(t.id);
      }
    } finally {
      enTour = false;
    }
  };

  return {
    tour,
    enVol: () => [...enVol.keys()],
    demarrer: () => { minuteur ??= setInterval(() => void tour(), o.intervalleMs); },
    arreter: async () => { clearInterval(minuteur); minuteur = undefined; await Promise.all(enVol.values()); },
  };
}
