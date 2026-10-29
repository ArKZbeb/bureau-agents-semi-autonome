import { ajouterAuJournal } from '../integrite/journal.ts';
import { appliquer, listerTaches, lireTache, type Tache } from '../taches/depot.ts';
import { avancer as avancerParDefaut, type DepsPipeline } from './pipeline.ts';

export type OptionsOrdonnanceur = { simultanees: number; intervalleMs: number; delaisErreurApiMs: number[]; horloge?: () => number };
type Avancer = (deps: DepsPipeline, tacheId: string) => Promise<Tache>;
type Suivi = {
  n: number;          // reprises déjà faites par l'ordonnanceur
  depuis: number;     // instant où la pause erreur_api suivante a été observée
  pauseVue: boolean;  // la pause suivant la reprise n-1 a-t-elle été observée ?
  epuise: boolean;
};

const estErreurApi = (t: Tache) => t.statut === 'en_pause' && (t.raison ?? '').startsWith('erreur_api');

export function creerOrdonnanceur(deps: DepsPipeline, o: OptionsOrdonnanceur, avancer: Avancer = avancerParDefaut) {
  const horloge = o.horloge ?? Date.now;
  const enVol = new Map<string, Promise<void>>();
  const tentatives = new Map<string, Suivi>();
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
        if (!estErreurApi(t)) {
          // Hors pause erreur_api, le compteur ne survit qu'à une relance par l'ordonnanceur (prête ou en cours).
          // Une reprise humaine d'une tâche épuisée repart de zéro.
          const suivi = tentatives.get(t.id);
          if (suivi?.epuise || !['prete', 'en_cours'].includes(t.statut)) tentatives.delete(t.id);
          continue;
        }
        const suivi = tentatives.get(t.id) ?? { n: 0, depuis: maintenant, pauseVue: false, epuise: false };
        tentatives.set(t.id, suivi);
        if (suivi.epuise) continue;
        if (suivi.n >= o.delaisErreurApiMs.length) {
          suivi.epuise = true;
          ajouterAuJournal(deps.db, deps.cle, { tacheId: t.id, type: 'evenement', commande: 'nouvelle tentative', couche: '—', decision: 'Refusé', decideur: 'Orchestrateur', raison: 'nouvelles tentatives épuisées : à reprendre à la main' });
          continue;
        }
        if (!suivi.pauseVue) {
          // Le délai se compte depuis cette observation : une étape plus longue que le délai ne provoque pas de relance immédiate.
          suivi.depuis = maintenant;
          suivi.pauseVue = true;
          continue;
        }
        if (maintenant - suivi.depuis >= o.delaisErreurApiMs[suivi.n]) {
          suivi.n++;
          suivi.pauseVue = false;
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

  // Une erreur de tour (base, horloge) est journalisée : le minuteur ne laisse jamais de promesse rejetée.
  const journaliserErreurTour = (e: unknown) => {
    try {
      ajouterAuJournal(deps.db, deps.cle, { tacheId: '—', type: 'evenement', commande: 'ordonnancement', couche: '—', decision: 'Refusé', decideur: 'Orchestrateur', raison: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    } catch {
      // Base indisponible : rien de plus à faire, le tour suivant réessaiera.
    }
  };

  return {
    tour,
    enVol: () => [...enVol.keys()],
    demarrer: () => { minuteur ??= setInterval(() => void tour().catch(journaliserErreurTour), o.intervalleMs); },
    arreter: async () => { clearInterval(minuteur); minuteur = undefined; await Promise.all(enVol.values()); },
  };
}
