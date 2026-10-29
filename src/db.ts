import { DatabaseSync } from 'node:sqlite';

export type Base = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS taches (
  id TEXT PRIMARY KEY, projet TEXT NOT NULL, titre TEXT NOT NULL, chemin_projet TEXT NOT NULL,
  etape TEXT NOT NULL, statut TEXT NOT NULL, raison TEXT,
  echanges_plan INTEGER NOT NULL DEFAULT 0, essais_qa INTEGER NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL, depense_usd REAL NOT NULL DEFAULT 0,
  reprise TEXT, maj_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artefacts (
  id INTEGER PRIMARY KEY, tache_id TEXT NOT NULL, type TEXT NOT NULL, contenu TEXT NOT NULL,
  sha256 TEXT NOT NULL, hmac TEXT NOT NULL, cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY, tache_id TEXT NOT NULL, horodatage TEXT NOT NULL, type TEXT NOT NULL,
  outil TEXT, commande TEXT NOT NULL, couche TEXT NOT NULL, decision TEXT NOT NULL,
  decideur TEXT NOT NULL, raison TEXT NOT NULL, tool_use_id TEXT,
  empreinte_prec TEXT NOT NULL, empreinte TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal_tete (
  id INTEGER PRIMARY KEY CHECK (id = 1), nombre INTEGER NOT NULL, empreinte TEXT NOT NULL, signature TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS escalades (
  id INTEGER PRIMARY KEY, tache_id TEXT NOT NULL, outil TEXT NOT NULL, entree TEXT NOT NULL,
  empreinte_appel TEXT NOT NULL, raison TEXT NOT NULL, statut TEXT NOT NULL, commentaire TEXT,
  cree_le TEXT NOT NULL, decide_le TEXT
);
CREATE TABLE IF NOT EXISTS autorisations (
  tache_id TEXT NOT NULL, empreinte_appel TEXT NOT NULL, decision TEXT NOT NULL,
  escalade_id INTEGER NOT NULL, utilisee INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tache_id, empreinte_appel)
);
`;

export function ouvrirBase(chemin: string): Base {
  const db = new DatabaseSync(chemin);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function enTransaction<T>(db: Base, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
