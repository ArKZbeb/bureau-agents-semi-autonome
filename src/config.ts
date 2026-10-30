import os from 'node:os';
import path from 'node:path';

export type Tarifs = Record<string, { entree: number; sortie: number }>;

export type NomModele = 'cadreur' | 'patron' | 'implementeur' | 'reviewer' | 'qa' | 'controleur';

const MODELES: Record<NomModele, string> = {
  cadreur: 'claude-opus-5-5', patron: 'claude-opus-5-5', implementeur: 'claude-sonnet-5-5',
  reviewer: 'claude-sonnet-5-5', qa: 'claude-opus-5-5', controleur: 'claude-haiku-5-5',
};

export type Config = {
  dossierDonnees: string;
  portUi: number;
  portConteneurs: number;
  adresseConteneurs: string | undefined;
  urlApiAmont: string;
  cleApi: string | undefined;
  modeleGardien: string;
  delaiGardienMs: number;
  tarifs: Tarifs;
  domainesAutorises: string[];
  conteneur: { memoire: number; cpus: number; pids: number };
  modeles: Record<NomModele, string>;
  tachesSimultanees: number;
  seuilCouvertureLignes: number;
  delaiAnalyseMs: number;
};

// $ par million de tokens
export const TARIFS: Tarifs = {
  'claude-opus-5-5': { entree: 4, sortie: 20 },
  'claude-sonnet-5-5': { entree: 2, sortie: 10 },
  'claude-haiku-5-5': { entree: 0.1, sortie: 0.5 },
};

// Entier entre min et max écrit en chiffres ; toute autre valeur donne la valeur par défaut.
function entierEntre(valeur: string | undefined, min: number, max: number, defaut: number): number {
  const n = Number(valeur);
  return valeur !== undefined && /^\d+$/.test(valeur) && Number.isSafeInteger(n) && n >= min && n <= max ? n : defaut;
}

// Entier ≥ 1 écrit en chiffres ; toute autre valeur (0, négatif, décimal, texte) donne la valeur par défaut.
function entierPositif(valeur: string | undefined, defaut: number): number {
  const n = Number(valeur);
  return valeur !== undefined && /^\d+$/.test(valeur) && Number.isSafeInteger(n) && n >= 1 ? n : defaut;
}

export function chargerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share');
  return {
    dossierDonnees: env.BUREAU_DONNEES ?? path.join(base, 'bureau-agents'),
    portUi: Number(env.BUREAU_PORT_UI ?? 4310),
    portConteneurs: Number(env.BUREAU_PORT_CONTENEURS ?? 4311),
    adresseConteneurs: env.BUREAU_ADRESSE_CONTENEURS,
    urlApiAmont: env.BUREAU_URL_API ?? 'https://api.anthropic.com',
    cleApi: env.ANTHROPIC_API_KEY,
    modeleGardien: env.BUREAU_MODELE_GARDIEN ?? 'claude-haiku-5-5',
    delaiGardienMs: 30_000,
    tarifs: TARIFS,
    domainesAutorises: ['registry.npmjs.org', 'api.nuget.org', 'nuget.org'],
    conteneur: { memoire: 4 * 1024 ** 3, cpus: 2, pids: 512 },
    modeles: Object.fromEntries(Object.entries(MODELES).map(([nom, defaut]) => [nom, env[`BUREAU_MODELE_${nom.toUpperCase()}`] ?? defaut])) as Record<NomModele, string>,
    tachesSimultanees: entierPositif(env.BUREAU_TACHES_SIMULTANEES, 2),
    seuilCouvertureLignes: entierEntre(env.BUREAU_SEUIL_COUVERTURE, 0, 100, 80),
    delaiAnalyseMs: 45 * 60_000,
  };
}
