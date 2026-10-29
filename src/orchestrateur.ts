import Anthropic from '@anthropic-ai/sdk';
import Docker from 'dockerode';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { Config } from './config.ts';
import {
  arreterConteneurs, assurerPasserelle, lireFichierConteneur, lireFichierVolume, nomCopie, nomRessource, preparerCopieControle, preparerEspace,
  resoudreCheminConteneur, supprimerCopieControle, resoudreCheminVolume,
  verifierDocker, verifierImage,
} from './conteneurs/docker.ts';
import { lancerEtape, type Agent, type DepsExecution, type ResultatEtape } from './conteneurs/execution.ts';
import { ouvrirBase, type Base } from './db.ts';
import { demanderAvis, type ClientAvis } from './gardien/avis.ts';
import { ficheDependance } from './gardien/dependances.ts';
import { decider, deciderEscalade, type DepsGardien } from './gardien/service.ts';
import { AnomalieIntegrite } from './integrite/anomalie.ts';
import { enregistrerArtefact, lireArtefact, type Artefact, type TypeArtefact } from './integrite/artefacts.ts';
import { chargerOuCreerCle } from './integrite/cle.ts';
import { ajouterAuJournal, lireJournal, verifierJournal, type NouvelleEntree } from './integrite/journal.ts';
import { verifierManifeste } from './integrite/manifeste.ts';
import { arbitrer, continuerBudget, repondreCadreur, reprendre, validerCadrage } from './pipeline/actions.ts';
import { demanderControle } from './pipeline/controleur.ts';
import { creerOrdonnanceur } from './pipeline/ordonnanceur.ts';
import type { DepsPipeline } from './pipeline/pipeline.ts';
import { Jetons } from './reseau/jetons.ts';
import { relayerApi } from './reseau/proxy-api.ts';
import { creerServeurConteneurs } from './reseau/serveur-conteneurs.ts';
import { creerServeurUi } from './reseau/serveur-ui.ts';
import { appliquer, creerTache, listerTaches, lireTache, reprendreApresRedemarrage, type NouvelleTache, type Tache } from './taches/depot.ts';
import { listerEchanges, lireProposition } from './taches/echanges.ts';

export type OptionsOrchestrateur = {
  config: Config; racineDepot: string; docker?: Docker; clientAvis?: ClientAvis; fetchDependances?: typeof fetch;
  surOutil?: DepsExecution['surOutil'];
};
export type Orchestrateur = {
  db: Base; jetonSession: string; urlUi: string;
  creerTache: (t: Omit<NouvelleTache, 'id'> & { id?: string; demande: string }) => Promise<Tache>;
  validerArtefact: (tacheId: string, type: TypeArtefact, contenu: string) => Artefact;
  lancerEtape: (tacheId: string, agent: Agent, prompt: string) => Promise<ResultatEtape>;
  deciderEscalade: (id: number, decision: 'approuver' | 'refuser', commentaire: string) => Tache;
  arretGlobal: () => Promise<{ conteneursArretes: number }>;
  ordonnanceur: ReturnType<typeof creerOrdonnanceur>;
  arreter: () => Promise<void>;
};

const ecouter = (s: http.Server, port: number) => new Promise<void>((ok, ko) => { s.once('error', ko); s.listen(port, '127.0.0.1', () => ok()); });
const fermer = (s: http.Server) => new Promise<void>(ok => { s.closeAllConnections(); s.close(() => ok()); });

export async function demarrerOrchestrateur(o: OptionsOrchestrateur): Promise<Orchestrateur> {
  const { config } = o;
  const docker = o.docker ?? new Docker();
  await verifierDocker(docker);
  const cle = chargerOuCreerCle(config.dossierDonnees);
  const db = ouvrirBase(path.join(config.dossierDonnees, 'bureau.sqlite'));
  // Démarrage refusé si le manifeste, l'image ou le journal est altéré.
  const manifeste = verifierManifeste(config.dossierDonnees, cle, o.racineDepot);
  await verifierImage(docker, manifeste.image);
  verifierJournal(db, cle);
  reprendreApresRedemarrage(db);
  await arreterConteneurs(docker);
  await assurerPasserelle(docker, manifeste.image, config.portConteneurs);

  const jetons = new Jetons();
  const evenements = new EventEmitter();
  const enCours = new Map<string, Docker.Container>();
  const journaliser = (e: NouvelleEntree) => ajouterAuJournal(db, cle, e);
  const client: ClientAvis | null = o.clientAvis ?? (config.cleApi ? new Anthropic({ apiKey: config.cleApi }) : null);
  const optionsAvis = {
    modele: config.modeleGardien, delaiMs: config.delaiGardienMs, tarifs: config.tarifs,
    promptSysteme: fs.readFileSync(path.join(o.racineDepot, 'agents', 'gardien.md'), 'utf8'),
  };

  const gardien: DepsGardien = {
    db, cle,
    lireFichier: (tacheId, chemin) => {
      const c = enCours.get(tacheId);
      return c ? lireFichierConteneur(c, chemin) : lireFichierVolume(docker, manifeste.image, nomRessource(tacheId), chemin);
    },
    resoudreChemin: (tacheId, chemin) => {
      const c = enCours.get(tacheId);
      return c ? resoudreCheminConteneur(c, chemin) : resoudreCheminVolume(docker, manifeste.image, nomRessource(tacheId), chemin);
    },
    avis: d => (client
      ? demanderAvis(client, optionsAvis, d)
      : Promise.resolve({ decision: 'refuser' as const, raison: 'clé API absente : avis du gardien impossible, refus par défaut', coutUsd: 0 })),
    fiche: d => ficheDependance(d, o.fetchDependances ?? fetch),
    surEscalade: id => evenements.emit('escalade', id),
  };

  const serveurConteneurs = creerServeurConteneurs({
    jetons, domaines: config.domainesAutorises, ports: [443],
    gardien: (id, e) => decider(gardien, id, e),
    api: (req, res) => relayerApi({
      db, jetons, urlAmont: config.urlApiAmont, cleApi: config.cleApi, tarifs: config.tarifs,
      surBudgetDepasse: id => journaliser({ tacheId: id, type: 'evenement', commande: 'appel API', couche: '—', decision: 'Refusé', decideur: 'Proxy', raison: 'Budget de la tâche dépassé' }),
    }, req, res),
    journaliserRefus: (id, cible) => journaliser({ tacheId: id ?? '—', type: 'reseau', commande: `connexion à ${cible}`, couche: '—', decision: 'Refusé', decideur: 'Proxy', raison: 'domaine hors liste blanche' }),
  });

  const arretGlobal = async () => {
    for (const t of listerTaches(db)) if (t.statut === 'en_cours') appliquer(db, t.id, { type: 'pause', raison: 'arret_global', detail: 'arrêt global demandé' });
    return { conteneursArretes: await arreterConteneurs(docker) };
  };
  const decision = (id: number, d: 'approuver' | 'refuser', commentaire: string) => deciderEscalade(db, cle, id, d, commentaire);

  const execution: DepsExecution = { docker, db, cle, jetons, evenements, config, racineDepot: o.racineDepot, enCours, surOutil: o.surOutil };
  const optionsControle = {
    modele: config.modeles.controleur, delaiMs: config.delaiGardienMs, tarifs: config.tarifs,
    promptSysteme: fs.readFileSync(path.join(o.racineDepot, 'agents', 'controleur.md'), 'utf8'),
  };
  const pipeline: DepsPipeline = {
    db, cle, config, racineDepot: o.racineDepot,
    executer: (id, agent, prompt, options) => lancerEtape(execution, id, agent, prompt, options),
    copie: (id, neuve) => (neuve ? preparerCopieControle(docker, manifeste.image, id) : Promise.resolve(nomCopie(id))),
    supprimerCopie: id => supprimerCopieControle(docker, id),
    controler: d => (client
      ? demanderControle(client, optionsControle, d)
      : Promise.resolve({ verdict: 'indisponible' as const, constats: ['clé API absente : contrôleur d’intégrité indisponible'], coutUsd: 0 })),
    lireFichier: (id, chemin) => lireFichierVolume(docker, manifeste.image, nomRessource(id), chemin),
  };
  const ordonnanceur = creerOrdonnanceur(pipeline, { simultanees: config.tachesSimultanees, intervalleMs: 5_000, delaisErreurApiMs: [60_000, 300_000, 900_000] });

  const creerTacheAvecDemande = async (t: Omit<NouvelleTache, 'id'> & { id?: string; demande: string }) => {
    const id = t.id ?? `T-${(db.prepare('SELECT count(*) AS n FROM taches').get() as { n: number }).n + 1}`;
    const tache = creerTache(db, { ...t, id });
    enregistrerArtefact(db, cle, id, 'demande', t.demande);
    try { await preparerEspace(docker, manifeste.image, id, t.cheminProjet); } catch (err) {
      appliquer(db, id, { type: 'abandon' });
      journaliser({ tacheId: id, type: 'evenement', commande: 'préparation impossible', couche: '—', decision: 'Refusé', decideur: 'Orchestrateur', raison: (err as Error).message.slice(0, 200) });
      throw err;
    }
    journaliser({ tacheId: id, type: 'evenement', commande: `git clone ${t.cheminProjet} ${id}`, couche: '—', decision: 'Autorisé', decideur: 'Orchestrateur', raison: 'préparation du conteneur' });
    return tache;
  };

  const jetonSession = randomBytes(24).toString('base64url');
  const serveurUi = creerServeurUi(jetonSession, {
    taches: () => listerTaches(db),
    journal: id => lireJournal(db, id ?? undefined),
    escalades: () => db.prepare(`SELECT id, tache_id AS tacheId, outil, entree, raison, cree_le AS creeLe FROM escalades WHERE statut = 'en_attente' ORDER BY id`).all(),
    deciderEscalade: decision,
    arretGlobal,
    tache: id => {
      try {
        const t = lireTache(db, id);
        try {
          const documents = Object.fromEntries((['demande', 'spec', 'criteres', 'plan', 'avis_patron', 'resume', 'rapport', 'avis_patron_code', 'verdict'] as const)
            .map(type => [type, lireArtefact(db, cle, id, type)?.contenu ?? null]));
          return { tache: t, documents, proposition: lireProposition(db, id), echanges: listerEchanges(db, id) };
        } catch (e) {
          if (e instanceof AnomalieIntegrite) return { tache: t, anomalie: e.message };
          throw e;
        }
      } catch {
        return null;
      }
    },
    creerTache: t => creerTacheAvecDemande(t),
    action: (id, nom, c) => {
      if (nom === 'reponse') return repondreCadreur(db, cle, id, String(c.texte ?? ''));
      if (nom === 'validation-cadrage') return validerCadrage(db, cle, id);
      if (nom === 'arbitrage') {
        if (c.choix !== 'cadreur' && c.choix !== 'alternative') throw new Error('choix attendu : cadreur ou alternative');
        return arbitrer(db, cle, id, c.choix);
      }
      if (nom === 'budget') return continuerBudget(db, cle, id, Number(c.montantUsd));
      return reprendre(db, cle, id);
    },
  });
  await ecouter(serveurConteneurs, config.portConteneurs);
  await ecouter(serveurUi, config.portUi);
  ordonnanceur.demarrer();
  return {
    db, jetonSession, urlUi: `http://127.0.0.1:${config.portUi}`,
    creerTache: creerTacheAvecDemande,
    validerArtefact: (tacheId, type, contenu) => enregistrerArtefact(db, cle, tacheId, type, contenu),
    lancerEtape: (tacheId, agent, prompt) => lancerEtape(execution, tacheId, agent, prompt),
    deciderEscalade: decision,
    arretGlobal,
    ordonnanceur,
    // Les tâches en cours restent « en cours » : au prochain démarrage, elles reprennent leur étape depuis le début.
    arreter: async () => {
      // Conteneurs d'abord, pour qu'une étape longue ne retienne pas l'attente de l'ordonnanceur.
      await arreterConteneurs(docker);
      await ordonnanceur.arreter();
      await fermer(serveurUi);
      await fermer(serveurConteneurs);
      db.close();
    },
  };
}
