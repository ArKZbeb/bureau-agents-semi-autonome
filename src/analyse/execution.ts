import type Docker from 'dockerode';
import {
  creerConteneurAnalyse, LABEL_TACHE, lireFichierVolume, nomRessource, preparerReseau, supprimerReseau, verifierImage,
} from '../conteneurs/docker.ts';
import { envTache, type DepsExecution } from '../conteneurs/execution.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
import { ajouterAuJournal } from '../integrite/journal.ts';
import { verifierManifeste } from '../integrite/manifeste.ts';
import { assemblerAnalyse, FICHIERS_MESURES, FICHIERS_TESTS, LIBELLES_OUTILS, OUTILS, type Analyse } from './analyse.ts';

export const nomVolumeMesures = (tacheId: string) => `${nomRessource(tacheId)}-mesures`;
const codeHttp = (e: unknown) => (e as { statusCode?: number }).statusCode;

/** Attend la fin du conteneur, au plus délaiMs ; faux si le délai est dépassé ou l'attente impossible. */
async function attendreFin(c: Docker.Container, delaiMs: number): Promise<boolean> {
  let minuteur: NodeJS.Timeout | undefined;
  const delai = new Promise<boolean>(fin => { minuteur = setTimeout(() => fin(false), Math.max(0, delaiMs)); });
  return Promise.race([c.wait().then(() => true, () => false), delai]).finally(() => clearTimeout(minuteur));
}

/**
 * Mesures de review, prises par l'orchestrateur hors de portée des agents, en deux conteneurs durcis (spike E21).
 * Précondition : `volume` est la copie de contrôle fraîche de l'étape de review, clonée depuis la branche et jamais
 * écrite par un agent ni par tester.sh. mesurer.sh tourne donc en premier, copie en lecture seule, et écrit dans un
 * volume des mesures propre à l'analyse ; tester.sh, qui exécute le code du dépôt, ne voit jamais ce volume.
 */
export async function executerAnalyse(deps: DepsExecution, tacheId: string, volume: string, base: string): Promise<Analyse> {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new AnomalieIntegrite('analyse', `commit de base invalide pour ${tacheId}`);
  const imageId = verifierManifeste(deps.config.dossierDonnees, deps.cle, deps.racineDepot).image;
  await verifierImage(deps.docker, imageId);
  const mesures = nomVolumeMesures(tacheId);
  const echeance = Date.now() + deps.config.delaiAnalyseMs;
  const jeton = deps.jetons.creer(tacheId, deps.config.delaiAnalyseMs + 10 * 60_000);
  const fichiers: Record<string, string | null> = {};
  try {
    const reseau = await preparerReseau(deps.docker, tacheId);
    // Volume des mesures neuf : aucun résultat d'une analyse précédente ne peut être relu.
    await deps.docker.getVolume(mesures).remove({ force: true }).catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; });
    await deps.docker.createVolume({ Name: mesures, Labels: { [LABEL_TACHE]: tacheId } });

    const lancer = async (cmd: string[], montages: Docker.MountConfig) => {
      const c = await creerConteneurAnalyse(deps.docker, { tacheId, imageId, reseau, env: envTache(jeton), ressources: deps.config.conteneur, cmd, montages });
      try {
        // Délai dépassé : le conteneur est supprimé ; ses outils sans .code seront « absent », donc no-go.
        await attendreFin(c, echeance - Date.now());
      } finally {
        await c.remove({ force: true }).catch(() => {});
      }
    };
    await lancer(['/opt/analyse/mesurer.sh', base], [
      { Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true },
      { Type: 'volume', Source: mesures, Target: '/mesures' },
    ]);
    if (Date.now() < echeance) await lancer(['/opt/analyse/tester.sh'], [{ Type: 'volume', Source: volume, Target: '/workspace' }]);

    // lireFichierVolume monte le volume lu sur /workspace : les mesures y sont à la racine.
    const lus = await Promise.all([
      ...FICHIERS_MESURES.map(f => lireFichierVolume(deps.docker, imageId, mesures, `/workspace/${f}`)),
      ...FICHIERS_TESTS.map(f => lireFichierVolume(deps.docker, imageId, volume, `/workspace/analyse/${f}`)),
    ]);
    [...FICHIERS_MESURES, ...FICHIERS_TESTS].forEach((f, i) => { fichiers[f] = lus[i]; });
  } finally {
    deps.jetons.revoquer(tacheId);
    await supprimerReseau(deps.docker, tacheId);
    await deps.docker.getVolume(mesures).remove({ force: true }).catch(() => {});
  }

  const analyse = assemblerAnalyse(base, fichiers);
  for (const o of [...OUTILS, 'couverture'] as const)
    ajouterAuJournal(deps.db, deps.cle, {
      tacheId, type: 'evenement', commande: LIBELLES_OUTILS[o], couche: '—', decision: 'Autorisé', decideur: 'Orchestrateur',
      raison: `analyse de review : ${analyse.outils[o]}`,
    });
  return analyse;
}
