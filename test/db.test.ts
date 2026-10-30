import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ouvrirBase, enTransaction } from '../src/db.ts';

test('crée toutes les tables', () => {
  const db = ouvrirBase(':memory:');
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(t => t.name);
  assert.deepEqual(tables, ['artefacts', 'artefacts_tete', 'autorisations', 'echanges', 'escalades', 'journal', 'journal_tete', 'propositions', 'seuils_projets', 'taches']);
});

test('les données survivent à la réouverture', () => {
  const chemin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-')), 'b.sqlite');
  const db = ouvrirBase(chemin);
  db.prepare("INSERT INTO taches (id, projet, titre, chemin_projet, etape, statut, budget_usd, maj_le) VALUES ('T-41', 'Film', 't', '/p', 'cadrage', 'prete', 6, 'x')").run();
  db.close();
  const db2 = ouvrirBase(chemin);
  assert.equal((db2.prepare('SELECT count(*) AS n FROM taches').get() as { n: number }).n, 1);
  db2.close();
});

test('enTransaction annule tout en cas d’erreur', () => {
  const db = ouvrirBase(':memory:');
  assert.throws(() => enTransaction(db, () => {
    db.prepare("INSERT INTO taches (id, projet, titre, chemin_projet, etape, statut, budget_usd, maj_le) VALUES ('T-1', 'p', 't', '/p', 'cadrage', 'prete', 1, 'x')").run();
    throw new Error('boum');
  }), /boum/);
  assert.equal((db.prepare('SELECT count(*) AS n FROM taches').get() as { n: number }).n, 0);
});

test('base existante sans colonne agent : colonne ajoutée à l’ouverture', () => {
  const chemin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-')), 'b.sqlite');
  const ancienne = new DatabaseSync(chemin);
  ancienne.exec(`CREATE TABLE taches (id TEXT PRIMARY KEY, projet TEXT NOT NULL, titre TEXT NOT NULL, chemin_projet TEXT NOT NULL,
    etape TEXT NOT NULL, statut TEXT NOT NULL, raison TEXT, echanges_plan INTEGER NOT NULL DEFAULT 0, essais_qa INTEGER NOT NULL DEFAULT 0,
    budget_usd REAL NOT NULL, depense_usd REAL NOT NULL DEFAULT 0, reprise TEXT, maj_le TEXT NOT NULL)`);
  ancienne.close();
  const db = ouvrirBase(chemin);
  const colonnes = (db.prepare('PRAGMA table_info(taches)').all() as { name: string }[]).map(c => c.name);
  assert.ok(colonnes.includes('agent'));
  assert.ok(colonnes.includes('commit_base'));
  db.close();
});
