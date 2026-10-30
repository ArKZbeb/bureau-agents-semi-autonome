import Anthropic from '@anthropic-ai/sdk';
import Docker from 'dockerode';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { Config } from './config.ts';
import {
  arreterConteneurs, assurerPasserelle, codeHttp, lireFichierConteneur, lireShaVolume, lireFichierVolume, lireFichierVolumeControle, nomCopie, nomRessource, preparerCopieControle, preparerEspace,
  resoudreCheminConteneur, supprimerCopieControle, resoudreCheminVolume,
  verifierDocker, verifierImage,
} from './conteneurs/docker.ts';
import { executerAnalyse, nomVolumeMesures } from './analyse/execution.ts';
import { lireBundle, lireValidation } from './conteneurs/validation.ts';
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
import {
  abandonner, arbitrer, continuerBudget, journaliserRepriseGlobale, pauserPourArretGlobal, relancer, renvoyer, repondreCadreur, reprendre, validerCadrage,
} from './pipeline/actions.ts';
import { demanderControle } from './pipeline/controleur.ts';
import { creerOrdonnanceur } from './pipeline/ordonnanceur.ts';
import type { DepsPipeline } from './pipeline/pipeline.ts';
import { adressesConteneurs } from './reseau/adresses.ts';
import { Jetons } from './reseau/jetons.ts';
import { relayerApi } from './reseau/proxy-api.ts';
import { creerServeurConteneurs } from './reseau/serveur-conteneurs.ts';
import { chargerPanneau } from './reseau/panneau.ts';
import { creerServeurUi } from './reseau/serveur-ui.ts';
import { appliquer, creerTache, definirCommitBase, listerTaches, lireTache, reprendreApresRedemarrage, type NouvelleTache, type Tache } from './taches/depot.ts';
import { detecterProjet, lireProjet, listerProjets, relierProjet } from './taches/projets.ts';
import { listerEchanges, lireProposition } from './taches/echanges.ts';
import { executerHote } from './validation/depot-hote.ts';
import { dossierValidation, historique, ouvrirPullRequest, recupererBranche, type DepsValidation } from './validation/service.ts';

export type OptionsOrchestrateur = {
  config: Config; racineDepot: string; docker?: Docker; clientAvis?: ClientAvis; fetchDependances?: typeof fetch;
  surOutil?: DepsExecution['surOutil'];
};
export type Orchestrateur = {
  db: Base; jetonSession: string; urlUi: string; urlPanneau: string;
  execution: DepsExecution;
  creerTache: (t: Omit<NouvelleTache, 'id'> & { id?: string; demande: string }) => Promise<Tache>;
  validerArtefact: (tacheId: string, type: TypeArtefact, contenu: string) => Artefact;
  lancerEtape: (tacheId: string, agent: Agent, prompt: string) => Promise<ResultatEtape>;
  deciderEscalade: (id: number, decision: 'approuver' | 'refuser', commentaire: string) => Tache;
  arretGlobal: () => Promise<{ conteneursArretes: number }>;
  ordonnanceur: ReturnType<typeof creerOrdonnanceur>;
  arreter: () => Promise<void>;
};

const ecouter = (s: http.Server, port: number, adresse = '127.0.0.1') => new Promise<void>((ok, ko) => { s.once('error', ko); s.listen(port, adresse, () => ok()); });
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
      return c ? lireFichierConteneur(c, chemin) : lireFichierVolumeControle(docker, manifeste.image, nomRessource(tacheId), chemin);
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

  const creerServeurDesConteneurs = () => creerServeurConteneurs({
    jetons, domaines: config.domainesAutorises, ports: [443],
    gardien: (id, e) => decider(gardien, id, e),
    api: (req, res) => relayerApi({
      db, jetons, urlAmont: config.urlApiAmont, cleApi: config.cleApi, tarifs: config.tarifs,
      surBudgetDepasse: id => journaliser({ tacheId: id, type: 'evenement', commande: 'appel API', couche: '—', decision: 'Refusé', decideur: 'Proxy', raison: 'Budget de la tâche dépassé' }),
    }, req, res),
    journaliserRefus: (id, cible) => journaliser({ tacheId: id ?? '—', type: 'reseau', commande: `connexion à ${cible}`, couche: '—', decision: 'Refusé', decideur: 'Proxy', raison: 'domaine hors liste blanche' }),
  });

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
    lireFichier: (volume, chemin) => lireFichierVolume(docker, manifeste.image, volume, chemin),
    analyser: (id, volume, base) => executerAnalyse(execution, id, volume, base),
    shaCopie: volume => lireShaVolume(docker, manifeste.image, volume),
  };
  const ordonnanceur = creerOrdonnanceur(pipeline, { simultanees: config.tachesSimultanees, intervalleMs: 5_000, delaisErreurApiMs: [60_000, 300_000, 900_000] });

  // Arrêt global : l'ordonnanceur est suspendu d'abord (plus aucune relance), puis toute tâche prête ou en cours
  // passe en pause, puis les conteneurs sont tués. Seule ma reprise globale réactive l'ordonnanceur.
  const arretGlobal = async () => {
    ordonnanceur.suspendre();
    pauserPourArretGlobal(db);
    return { conteneursArretes: await arreterConteneurs(docker) };
  };
  const repriseGlobale = () => {
    ordonnanceur.reactiver();
    journaliserRepriseGlobale(db, cle);
    return { ordonnanceur: 'actif' };
  };

  const creerTacheAvecDemande = async (t: Omit<NouvelleTache, 'id'> & { id?: string; demande: string }) => {
    if (t.id !== undefined && !/^T-\d+$/.test(t.id)) throw new Error(`identifiant de tâche invalide : ${t.id}`);
    const id = t.id ?? `T-${(db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) AS n FROM taches`).get() as { n: number }).n + 1}`;
    // L'espace est prêt avant que la tâche n'existe : l'ordonnanceur ne peut pas la lancer sur un volume vide.
    let base: string | null = null;
    let volumeCree = false;
    try {
      await preparerEspace(docker, manifeste.image, id, t.cheminProjet);
      volumeCree = true;
      base = await lireShaVolume(docker, manifeste.image, nomRessource(id));
      if (!base) throw new Error('commit de base illisible dans l’espace de la tâche');
    } catch (err) {
      // preparerEspace nettoie lui-même ses échecs (et ne doit jamais supprimer l'espace d'une tâche existante) ; seul le volume créé ici est retiré.
      if (volumeCree) await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
      journaliser({ tacheId: id, type: 'evenement', commande: 'préparation impossible', couche: '—', decision: 'Refusé', decideur: 'Orchestrateur', raison: (err as Error).message.slice(0, 200) });
      throw err;
    }
    creerTache(db, { ...t, id });
    definirCommitBase(db, id, base);
    const tache = lireTache(db, id);
    enregistrerArtefact(db, cle, id, 'demande', t.demande);
    journaliser({ tacheId: id, type: 'evenement', commande: `git clone ${t.cheminProjet} ${id}`, couche: '—', decision: 'Autorisé', decideur: 'Orchestrateur', raison: 'préparation du conteneur' });
    return tache;
  };

  const depsValidation: DepsValidation = {
    db, cle, executer: executerHote,
    lire: (volume, base, sha) => lireValidation(docker, manifeste.image, volume, base, sha),
    bundle: (volume, tacheId, base, sha) => lireBundle(docker, manifeste.image, volume, tacheId, base, sha),
    supprimerVolumes: async tacheId => {
      for (const v of [nomRessource(tacheId), nomVolumeMesures(tacheId), nomCopie(tacheId)])
        await docker.getVolume(v).remove({ force: true }).catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; });
    },
  };
  // Abandon : la tâche est close d'abord ; conteneurs et volumes sont ensuite retirés, un échec de nettoyage est journalisé seulement.
  const abandonnerTache = async (id: string) => {
    const t = abandonner(db, cle, id);
    try {
      await arreterConteneurs(docker, id);
      await depsValidation.supprimerVolumes(id);
    } catch (e) {
      journaliser({ tacheId: id, type: 'evenement', commande: 'nettoyage après abandon', couche: '—', decision: 'Erreur', decideur: 'Orchestrateur', raison: (e as Error).message.slice(0, 200) });
    }
    return t;
  };

  const jetonSession = randomBytes(24).toString('base64url');
  const serveurUi = creerServeurUi(jetonSession, {
    taches: () => listerTaches(db),
    journal: id => lireJournal(db, id ?? undefined),
    escalades: () => db.prepare(`SELECT id, tache_id AS tacheId, outil, entree, raison, cree_le AS creeLe FROM escalades WHERE statut = 'en_attente' ORDER BY id`).all(),
    integriteJournal: () => {
      const entrees = (db.prepare('SELECT COUNT(*) AS n FROM journal').get() as { n: number }).n;
      try {
        verifierJournal(db, cle);
        return { intacte: true, entrees };
      } catch (e) {
        return { intacte: false, entrees, erreur: (e as Error).message };
      }
    },
    etat: () => ({ ordonnanceur: ordonnanceur.estSuspendu() ? 'suspendu' : 'actif' }),
    projets: () => listerProjets(db, config.seuilCouvertureLignes),
    detecterProjet: chemin => detecterProjet(chemin),
    relierProjet: p => relierProjet(db, p),
    deciderEscalade: decision,
    arretGlobal,
    repriseGlobale,
    tache: id => {
      if (!db.prepare('SELECT 1 FROM taches WHERE id = ?').get(id)) return null;
      const t = lireTache(db, id);
      try {
        const documents = Object.fromEntries((['demande', 'spec', 'criteres', 'plan', 'avis_patron', 'resume', 'rapport', 'avis_patron_code', 'verdict', 'analyse'] as const)
          .map(type => [type, lireArtefact(db, cle, id, type)?.contenu ?? null]));
        return { tache: t, documents, proposition: lireProposition(db, id), echanges: listerEchanges(db, id) };
      } catch (e) {
        if (!(e instanceof AnomalieIntegrite)) throw e;
        // Une anomalie constatée à la lecture met la tâche en pause quand la machine à états le permet ; sinon, journal seul.
        if (t.statut === 'prete' || t.statut === 'en_cours') appliquer(db, id, { type: 'pause', raison: 'integrite', detail: e.message });
        journaliser({ tacheId: id, type: 'evenement', commande: 'lecture des documents', couche: '—', decision: 'Refusé', decideur: 'Contrôleur d’intégrité', raison: e.message.slice(0, 200) });
        return { tache: lireTache(db, id), anomalie: e.message };
      }
    },
    creerTache: ({ projet, titre, demande }) => {
      const p = lireProjet(db, projet, config.seuilCouvertureLignes);
      if (!p) throw new Error(`projet non relié : ${projet}`);
      return creerTacheAvecDemande({ projet: p.nom, titre, demande, cheminProjet: p.chemin, budgetUsd: p.budgetUsd });
    },
    action: (id, nom, c) => {
      if (nom === 'reponse') return repondreCadreur(db, cle, id, String(c.texte ?? ''));
      if (nom === 'validation-cadrage') return validerCadrage(db, cle, id);
      if (nom === 'arbitrage') {
        if (c.choix !== 'cadreur' && c.choix !== 'alternative') throw new Error('choix attendu : cadreur ou alternative');
        return arbitrer(db, cle, id, c.choix);
      }
      if (nom === 'budget') return continuerBudget(db, cle, id, Number(c.montantUsd));
      if (nom === 'recuperation') return recupererBranche(depsValidation, id);
      if (nom === 'pr') return ouvrirPullRequest(depsValidation, id);
      if (nom === 'renvoi') return renvoyer(db, cle, id, String(c.commentaire));
      if (nom === 'relance') {
        if (c.vers !== 'implementation' && c.vers !== 'cadrage') throw new Error('vers attendu : implementation ou cadrage');
        return relancer(db, cle, id, c.vers, typeof c.commentaire === 'string' ? c.commentaire : null);
      }
      if (nom === 'abandon') return abandonnerTache(id);
      return reprendre(db, cle, id);
    },
    validation: id => dossierValidation(depsValidation, id),
    historique: id => historique(depsValidation, id),
  }, chargerPanneau(path.join(o.racineDepot, 'web', 'dist', 'web', 'browser')));
  // Le serveur des conteneurs écoute sur 127.0.0.1 et sur la passerelle du pont Docker (jamais 0.0.0.0) : sous Linux, host.docker.internal y mène.
  const passerelleBridge = await docker.getNetwork('bridge').inspect().then(
    (n: { IPAM?: { Config?: { Gateway?: string }[] } }) => n.IPAM?.Config?.[0]?.Gateway ?? null, () => null);
  const serveursConteneurs: http.Server[] = [];
  try {
    for (const adresse of adressesConteneurs(passerelleBridge, config.adresseConteneurs)) {
      const s = creerServeurDesConteneurs();
      serveursConteneurs.push(s);
      await ecouter(s, config.portConteneurs, adresse);
    }
    await ecouter(serveurUi, config.portUi);
  } catch (e) {
    await Promise.all(serveursConteneurs.map(fermer));
    throw e;
  }
  ordonnanceur.demarrer();
  return {
    db, jetonSession, urlUi: `http://127.0.0.1:${config.portUi}`, urlPanneau: `http://127.0.0.1:${config.portUi}/#jeton=${jetonSession}`, execution,
    creerTache: creerTacheAvecDemande,
    validerArtefact: (tacheId, type, contenu) => enregistrerArtefact(db, cle, tacheId, type, contenu),
    lancerEtape: (tacheId, agent, prompt) => lancerEtape(execution, tacheId, agent, prompt),
    deciderEscalade: decision,
    arretGlobal,
    ordonnanceur,
    // Les étapes interrompues par l'arrêt passent en pause erreur_api et seront relancées par l'ordonnanceur ; les tâches « en cours » à l'arrêt brutal reprennent leur étape au redémarrage.
    arreter: async () => {
      // Le minuteur s'arrête tout de suite ; les conteneurs sont arrêtés pendant que l'ordonnanceur attend les étapes en vol.
      const fin = ordonnanceur.arreter();
      await arreterConteneurs(docker);
      await fin;
      await fermer(serveurUi);
      await Promise.all(serveursConteneurs.map(fermer));
      db.close();
    },
  };
}
