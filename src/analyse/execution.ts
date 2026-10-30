import type Docker from 'dockerode';
import {
  creerConteneurAnalyse, LABEL_TACHE, lireFichierVolume, nomRessource, PLAFOND_ANALYSE, preparerReseau, supprimerReseau, verifierImage,
} from '../conteneurs/docker.ts';
import { envSortie, type DepsExecution } from '../conteneurs/execution.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
import { ajouterAuJournal } from '../integrite/journal.ts';
import { verifierManifeste } from '../integrite/manifeste.ts';
import { lireTache } from '../taches/depot.ts';
import { assemblerAnalyse, FICHIERS_MESURES, FICHIERS_TESTS, LIBELLES_OUTILS, OUTILS, type Analyse } from './analyse.ts';

export const nomVolumeMesures = (tacheId: string) => `${nomRessource(tacheId)}-mesures`;
const codeHttp = (e: unknown) => (e as { statusCode?: number }).statusCode;
/** Conteneurs jetables de lecture lancés en même temps, au plus. */
const LECTURES_SIMULTANEES = 4;

type Fin = 'terminee' | 'delai' | 'attente_impossible';

/** Attend la fin du conteneur, au plus délaiMs. */
async function attendreFin(c: Docker.Container, delaiMs: number): Promise<Fin> {
  let minuteur: NodeJS.Timeout | undefined;
  const delai = new Promise<Fin>(fin => { minuteur = setTimeout(() => fin('delai'), Math.max(0, delaiMs)); });
  return Promise.race([c.wait().then((): Fin => 'terminee', (): Fin => 'attente_impossible'), delai]).finally(() => clearTimeout(minuteur));
}

/** Applique f à chaque élément, au plus n à la fois, en gardant l'ordre des résultats. */
async function parLots<T, R>(elements: T[], n: number, f: (e: T) => Promise<R>): Promise<R[]> {
  const resultats: R[] = new Array(elements.length);
  let suivant = 0;
  const ouvrier = async () => { while (suivant < elements.length) { const i = suivant++; resultats[i] = await f(elements[i]); } };
  await Promise.all(Array.from({ length: Math.min(n, elements.length) }, ouvrier));
  return resultats;
}

/**
 * Mesures de review, prises par l'orchestrateur hors de portée des agents, en deux conteneurs durcis (spike E21).
 * Précondition : `volume` est la copie de contrôle fraîche de l'étape de review, clonée depuis la branche et jamais
 * écrite par un agent ni par tester.sh. mesurer.sh tourne donc en premier, copie en lecture seule, et écrit dans un
 * volume des mesures propre à l'analyse ; tester.sh, qui exécute le code du dépôt, ne voit jamais ce volume.
 * Coupe-circuit : la tâche doit rester « prete » ; sinon (arrêt global, pause), aucun conteneur ne démarre plus.
 */
export async function executerAnalyse(deps: DepsExecution, tacheId: string, volume: string, base: string): Promise<Analyse> {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new AnomalieIntegrite('analyse', `commit de base invalide pour ${tacheId}`);
  const imageId = verifierManifeste(deps.config.dossierDonnees, deps.cle, deps.racineDepot).image;
  await verifierImage(deps.docker, imageId);
  const mesures = nomVolumeMesures(tacheId);
  const echeance = Date.now() + deps.config.delaiAnalyseMs;
  const journaliser = (raison: string) => ajouterAuJournal(deps.db, deps.cle, {
    tacheId, type: 'evenement', commande: 'analyse de review', couche: '—', decision: 'Erreur', decideur: 'Orchestrateur', raison,
  });
  const verifierStatut = () => {
    const statut = lireTache(deps.db, tacheId).statut;
    if (statut !== 'prete') throw new Error(`analyse interrompue : tâche ${statut}`);
  };
  // Portée « sortie » : passerelle vers la liste blanche seulement, ni API ni gardien.
  const jeton = deps.jetons.creer(tacheId, deps.config.delaiAnalyseMs + 10 * 60_000, 'sortie');
  const fichiers: Record<string, string | null> = {};
  let erreur: unknown = null;
  try {
    const reseau = await preparerReseau(deps.docker, tacheId);
    // Volume des mesures neuf : aucun résultat d'une analyse précédente ne peut être relu.
    await deps.docker.getVolume(mesures).remove({ force: true }).catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; });
    await deps.docker.createVolume({ Name: mesures, Labels: { [LABEL_TACHE]: tacheId } });

    const lancer = async (cmd: string[], montages: Docker.MountConfig): Promise<Fin> => {
      verifierStatut();
      const c = await creerConteneurAnalyse(deps.docker, { tacheId, imageId, reseau, env: envSortie(jeton), ressources: deps.config.conteneur, cmd, montages });
      try {
        // Arrêt global pendant le démarrage : le conteneur est supprimé (finally) sans rien attendre.
        verifierStatut();
        return await attendreFin(c, echeance - Date.now());
      } finally {
        await c.remove({ force: true }).catch(() => {});
      }
    };
    const finMesures = await lancer(['/opt/analyse/mesurer.sh', base], [
      { Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true },
      { Type: 'volume', Source: mesures, Target: '/mesures' },
    ]);
    // Mesures non terminées normalement : le code du dépôt n'est pas lancé ; les outils sans .code seront « absent » (no-go).
    if (finMesures === 'terminee') {
      const finTests = await lancer(['/opt/analyse/tester.sh'], [{ Type: 'volume', Source: volume, Target: '/workspace' }]);
      if (finTests !== 'terminee') journaliser(finTests === 'delai' ? 'analyse : délai dépassé' : 'analyse : attente du conteneur impossible');
    } else {
      journaliser(finMesures === 'delai' ? 'analyse : délai dépassé' : 'analyse : attente du conteneur impossible');
    }
    // Une fin d'attente due à un arrêt global ressemble à une fin normale : rien n'est relu pour une tâche arrêtée.
    verifierStatut();

    // lireFichierVolume monte le volume lu sur /workspace : les mesures y sont à la racine. Au-delà du plafond
    // d'analyse, un fichier est illisible (null), donc sa mesure absente : jamais de diff ni de Cobertura tronqué.
    const lectures: [string, string, string][] = [
      ...FICHIERS_MESURES.map((f): [string, string, string] => [f, mesures, `/workspace/${f}`]),
      ...FICHIERS_TESTS.map((f): [string, string, string] => [f, volume, `/workspace/analyse/${f}`]),
    ];
    const lus = await parLots(lectures, LECTURES_SIMULTANEES, ([, v, chemin]) => lireFichierVolume(deps.docker, imageId, v, chemin, PLAFOND_ANALYSE));
    lectures.forEach(([f], i) => { fichiers[f] = lus[i]; });
  } catch (e) {
    erreur = e;
  }

  // Nettoyage : chaque étape indépendante des autres ; l'erreur d'origine prime sur celles du nettoyage.
  const nettoyage: unknown[] = [];
  const etape = async (f: () => unknown) => { try { await f(); } catch (e) { nettoyage.push(e); } };
  await etape(() => deps.jetons.revoquer(tacheId));
  await etape(() => deps.docker.getVolume(mesures).remove({ force: true }).catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; }));
  await etape(() => supprimerReseau(deps.docker, tacheId));
  if (erreur !== null) throw erreur;
  if (nettoyage.length) throw nettoyage[0];

  const analyse = assemblerAnalyse(base, fichiers);
  for (const o of [...OUTILS, 'couverture'] as const)
    ajouterAuJournal(deps.db, deps.cle, {
      tacheId, type: 'evenement', commande: LIBELLES_OUTILS[o], couche: '—', decision: 'Autorisé', decideur: 'Orchestrateur',
      raison: `analyse de review : ${analyse.outils[o]}`,
    });
  return analyse;
}
