export type Etape = 'cadrage' | 'patron_plan' | 'implementation' | 'review' | 'patron_code' | 'qa' | 'validation';
export type Statut = 'prete' | 'en_cours' | 'en_pause' | 'bloquee' | 'attente_humain' | 'terminee' | 'abandonnee';
export type Tache = {
  id: string; projet: string; titre: string; cheminProjet: string; etape: Etape; statut: Statut; raison: string | null;
  echangesPlan: number; essaisQa: number; budgetUsd: number; depenseUsd: number; agent: string | null;
};
export type Projet = { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number; relieLe: string };
export type Detection = {
  chemin: string; nomPropose: string; git: boolean;
  dotnet: { solution: string | null; projets: number; projetsTests: number } | null;
  angular: { fichier: string } | null;
};
export type EntreeJournal = {
  id: number; tacheId: string; horodatage: string; type: string; outil: string | null; commande: string;
  couche: string; decision: string; decideur: string; raison: string;
};
export type Escalade = { id: number; tacheId: string; outil: string; entree: string; raison: string; creeLe: string };
export type Echange = { auteur: 'cadreur' | 'moi'; texte: string; creeLe: string };
export type Proposition = { spec: string; criteres: string[]; plan: string };
export type TypeDocument = 'demande' | 'spec' | 'criteres' | 'plan' | 'avis_patron' | 'resume' | 'rapport' | 'avis_patron_code' | 'verdict' | 'analyse';
export type FicheTache = {
  tache: Tache; documents?: Record<TypeDocument, string | null>; proposition?: Proposition | null; echanges?: Echange[]; anomalie?: string;
};
export type StatutOutil = 'ok' | 'echec' | 'absent' | 'non_applicable';
export type Analyse = {
  sha: string; base: string; outils: Record<string, StatutOutil>;
  tests: { total: number; echecs: number } | null;
  couverture: { couvertes: number; total: number; pourcentage: number | null; sourcesHorsCouverture: string[] } | null;
  constats: { outil: string; severite: 'critique' | 'haute' | 'moyenne' | 'basse'; message: string; fichier: string | null }[];
  signalements: string[];
};
export type Verdict = {
  qa: { verdict: 'go' | 'no_go'; criteres: { numero: number; rempli: boolean; preuve: string }[] };
  regles: string[]; verdict: 'go' | 'no_go';
};
export type IntegriteJournal = { intacte: boolean; entrees: number; erreur?: string };
export type EtatGlobal = { ordonnanceur: 'actif' | 'suspendu' };
export type NomAction = 'reponse' | 'validation-cadrage' | 'arbitrage' | 'budget' | 'reprise' | 'recuperation' | 'pr' | 'renvoi' | 'relance' | 'abandon';
export type FichierModifie = { fichier: string; ajouts: number | null; suppressions: number | null };
export type DossierValidation = {
  branche: string; sha: string; commits: number; fichiers: FichierModifie[]; diff: string; tronque: boolean;
  integrite: { verifiee: true } | { verifiee: false; raison: string };
  journal: { commandes: number; refus: number; escalades: number };
};
export type EntreeHistorique = { creeLe: string; verdict: 'go' | 'no_go'; regles: string[]; criteresNonRemplis: { numero: number; preuve: string }[] };
