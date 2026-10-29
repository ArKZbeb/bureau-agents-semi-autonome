import Anthropic from '@anthropic-ai/sdk';
import Docker from 'dockerode';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { Config } from './config.ts';
import {
  arreterConteneurs, assurerPasserelle, lireFichierConteneur, lireFichierVolume, nomRessource, preparerEspace, verifierDocker, verifierImage,
} from './conteneurs/docker.ts';
import { lancerEtape, type Agent, type DepsExecution, type ResultatEtape } from './conteneurs/execution.ts';
import { ouvrirBase, type Base } from './db.ts';
import { demanderAvis, type ClientAvis } from './gardien/avis.ts';
import { ficheDependance } from './gardien/dependances.ts';
import { decider, deciderEscalade, type DepsGardien } from './gardien/service.ts';
import { enregistrerArtefact, type Artefact, type TypeArtefact } from './integrite/artefacts.ts';
import { chargerOuCreerCle } from './integrite/cle.ts';
import { ajouterAuJournal, lireJournal, verifierJournal, type NouvelleEntree } from './integrite/journal.ts';
import { verifierManifeste } from './integrite/manifeste.ts';
import { Jetons } from './reseau/jetons.ts';
import { relayerApi } from './reseau/proxy-api.ts';
import { creerServeurConteneurs } from './reseau/serveur-conteneurs.ts';
import { creerServeurUi } from './reseau/serveur-ui.ts';
import { appliquer, creerTache, listerTaches, reprendreApresRedemarrage, type NouvelleTache, type Tache } from './taches/depot.ts';

export type OptionsOrchestrateur = {
  config: Config; racineDepot: string; docker?: Docker; clientAvis?: ClientAvis; fetchDependances?: typeof fetch;
  surOutil?: DepsExecution['surOutil'];
};
export type Orchestrateur = {
  db: Base; jetonSession: string; urlUi: string;
  creerTache: (t: NouvelleTache) => Promise<Tache>;
  validerArtefact: (tacheId: string, type: TypeArtefact, contenu: string) => Artefact;
  lancerEtape: (tacheId: string, agent: Agent, prompt: string) => Promise<ResultatEtape>;
  deciderEscalade: (id: number, decision: 'approuver' | 'refuser', commentaire: string) => Tache;
  arretGlobal: () => Promise<{ conteneursArretes: number }>;
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

  const jetonSession = randomBytes(24).toString('base64url');
  const serveurUi = creerServeurUi(jetonSession, {
    taches: () => listerTaches(db),
    journal: id => lireJournal(db, id ?? undefined),
    escalades: () => db.prepare(`SELECT id, tache_id AS tacheId, outil, entree, raison, cree_le AS creeLe FROM escalades WHERE statut = 'en_attente' ORDER BY id`).all(),
    deciderEscalade: decision,
    arretGlobal,
  });
  await ecouter(serveurConteneurs, config.portConteneurs);
  await ecouter(serveurUi, config.portUi);

  const execution: DepsExecution = { docker, db, cle, jetons, evenements, config, racineDepot: o.racineDepot, enCours, surOutil: o.surOutil };
  return {
    db, jetonSession, urlUi: `http://127.0.0.1:${config.portUi}`,
    creerTache: async t => {
      const tache = creerTache(db, t);
      await preparerEspace(docker, manifeste.image, t.id, t.cheminProjet);
      journaliser({ tacheId: t.id, type: 'evenement', commande: `git clone ${t.cheminProjet} ${t.id}`, couche: '—', decision: 'Autorisé', decideur: 'Orchestrateur', raison: 'préparation du conteneur' });
      return tache;
    },
    validerArtefact: (tacheId, type, contenu) => enregistrerArtefact(db, cle, tacheId, type, contenu),
    lancerEtape: (tacheId, agent, prompt) => lancerEtape(execution, tacheId, agent, prompt),
    deciderEscalade: decision,
    arretGlobal,
    // Les tâches en cours restent « en cours » : au prochain démarrage, elles reprennent leur étape depuis le début.
    arreter: async () => {
      await arreterConteneurs(docker);
      await fermer(serveurUi);
      await fermer(serveurConteneurs);
      db.close();
    },
  };
}
