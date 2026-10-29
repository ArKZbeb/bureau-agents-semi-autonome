import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, type Base } from '../../src/db.ts';
import { ajouterAuJournal, verifierJournal, lireJournal } from '../../src/integrite/journal.ts';
import { AnomalieIntegrite } from '../../src/integrite/anomalie.ts';

const cle = Buffer.alloc(32, 2);

function journalDeTrois(): Base {
  const db = ouvrirBase(':memory:');
  const base = { tacheId: 'T-41', type: 'decision' as const, outil: 'Bash', couche: '2' as const };
  ajouterAuJournal(db, cle, { ...base, commande: 'dotnet build Film.sln', decision: 'Autorisé', decideur: 'Liste blanche', raison: 'commande de build' });
  ajouterAuJournal(db, cle, { ...base, commande: 'cat /proc/self/environ', decision: 'Refusé', decideur: 'Liste noire', raison: 'lecture des variables d’environnement' });
  ajouterAuJournal(db, cle, { ...base, commande: 'npm ci', decision: 'Autorisé', decideur: 'Liste blanche', raison: 'installation verrouillée' });
  return db;
}

test('journal intact vérifié et relu', () => {
  const db = journalDeTrois();
  verifierJournal(db, cle);
  const j = lireJournal(db, 'T-41');
  assert.equal(j.length, 3);
  assert.equal(j[1].decision, 'Refusé');
  assert.equal(lireJournal(db, 'T-99').length, 0);
});

test('journal vide valide', () => verifierJournal(ouvrirBase(':memory:'), cle));

const alterations: [string, (db: Base) => void][] = [
  ['ligne modifiée', db => db.prepare("UPDATE journal SET decision = 'Autorisé' WHERE id = 2").run()],
  ['ligne du milieu supprimée', db => db.prepare('DELETE FROM journal WHERE id = 2').run()],
  ['dernière ligne supprimée', db => db.prepare('DELETE FROM journal WHERE id = 3').run()],
  ['empreinte remplacée', db => db.prepare("UPDATE journal SET empreinte = 'aa' WHERE id = 1").run()],
  ['tête supprimée', db => db.prepare('DELETE FROM journal_tete').run()],
  ['ligne insérée', db => db.prepare("INSERT INTO journal (tache_id, horodatage, type, commande, couche, decision, decideur, raison, empreinte_prec, empreinte) SELECT tache_id, horodatage, type, 'rm -rf /', couche, 'Autorisé', decideur, raison, empreinte, empreinte FROM journal WHERE id = 3").run()],
];

for (const [nom, alterer] of alterations) {
  test(`altération détectée : ${nom}`, () => {
    const db = journalDeTrois();
    alterer(db);
    assert.throws(() => verifierJournal(db, cle), AnomalieIntegrite);
  });
}

test('une autre clé ne valide pas la chaîne', () => {
  assert.throws(() => verifierJournal(journalDeTrois(), Buffer.alloc(32, 9)), AnomalieIntegrite);
});

// Une écriture après une suppression ne doit jamais effacer la trace de cette suppression.
for (const [nom, alterer] of [
  ['dernière ligne supprimée', (db: Base) => db.prepare('DELETE FROM journal WHERE id = 3').run()],
  ['tête supprimée', (db: Base) => db.prepare('DELETE FROM journal_tete').run()],
] as const) {
  test(`altération toujours détectée après un nouvel ajout : ${nom}`, () => {
    const db = journalDeTrois();
    alterer(db);
    ajouterAuJournal(db, cle, { tacheId: 'T-41', type: 'decision', outil: 'Bash', couche: '2', commande: 'dotnet test', decision: 'Autorisé', decideur: 'Liste blanche', raison: 'tests' });
    assert.throws(() => verifierJournal(db, cle), AnomalieIntegrite);
  });
}
