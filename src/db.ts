import { DatabaseSync } from 'node:sqlite';

export type Base = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS taches (
  id TEXT PRIMARY KEY, projet TEXT NOT NULL, titre TEXT NOT NULL, chemin_projet TEXT NOT NULL,
  etape TEXT NOT NULL, statut TEXT NOT NULL, raison TEXT,
  echanges_plan INTEGER NOT NULL DEFAULT 0, essais_qa INTEGER NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL, depense_usd REAL NOT NULL DEFAULT 0,
  reprise TEXT, agent TEXT, commit_base TEXT, maj_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artefacts (
  id INTEGER PRIMARY KEY, tache_id TEXT NOT NULL, type TEXT NOT NULL, contenu TEXT NOT NULL,
  sha256 TEXT NOT NULL, hmac TEXT NOT NULL, cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artefacts_tete (
  tache_id TEXT NOT NULL, type TEXT NOT NULL, nombre INTEGER NOT NULL, empreinte TEXT NOT NULL, signature TEXT NOT NULL,
  PRIMARY KEY (tache_id, type)
);
CREATE TABLE IF NOT EXISTS echanges (
  id INTEGER PRIMARY KEY, tache_id TEXT NOT NULL, auteur TEXT NOT NULL, texte TEXT NOT NULL, cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS propositions (
  tache_id TEXT PRIMARY KEY, contenu TEXT NOT NULL, cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seuils_projets (
  projet TEXT PRIMARY KEY, couverture_lignes INTEGER NOT NULL CHECK (couverture_lignes BETWEEN 0 AND 100)
);
CREATE TABLE IF NOT EXISTS projets (
  nom TEXT PRIMARY KEY, chemin TEXT NOT NULL UNIQUE, budget_usd REAL NOT NULL, relie_le TEXT NOT NULL
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
  // Bases créées avant la phase 2 : la colonne de l'agent courant est ajoutée sans perte.
  const colonnes = (db.prepare('PRAGMA table_info(taches)').all() as { name: string }[]).map(c => c.name);
  if (!colonnes.includes('agent')) db.exec('ALTER TABLE taches ADD COLUMN agent TEXT');
  if (!colonnes.includes('commit_base')) db.exec('ALTER TABLE taches ADD COLUMN commit_base TEXT');
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
