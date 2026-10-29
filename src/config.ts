import os from 'node:os';
import path from 'node:path';

export type Tarifs = Record<string, { entree: number; sortie: number }>;

export type Config = {
  dossierDonnees: string;
  portUi: number;
  portConteneurs: number;
  urlApiAmont: string;
  cleApi: string | undefined;
  modeleGardien: string;
  delaiGardienMs: number;
  tarifs: Tarifs;
  domainesAutorises: string[];
  conteneur: { memoire: number; cpus: number; pids: number };
};

// $ par million de tokens
export const TARIFS: Tarifs = {
  'claude-opus-5-5': { entree: 4, sortie: 20 },
  'claude-sonnet-5-5': { entree: 2, sortie: 10 },
  'claude-haiku-5-5': { entree: 0.1, sortie: 0.5 },
};

export function chargerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share');
  return {
    dossierDonnees: env.BUREAU_DONNEES ?? path.join(base, 'bureau-agents'),
    portUi: Number(env.BUREAU_PORT_UI ?? 4310),
    portConteneurs: Number(env.BUREAU_PORT_CONTENEURS ?? 4311),
    urlApiAmont: env.BUREAU_URL_API ?? 'https://api.anthropic.com',
    cleApi: env.ANTHROPIC_API_KEY,
    modeleGardien: env.BUREAU_MODELE_GARDIEN ?? 'claude-haiku-5-5',
    delaiGardienMs: 30_000,
    tarifs: TARIFS,
    domainesAutorises: ['registry.npmjs.org', 'api.nuget.org', 'nuget.org'],
    conteneur: { memoire: 4 * 1024 ** 3, cpus: 2, pids: 512 },
  };
}
