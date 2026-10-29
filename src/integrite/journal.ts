import { enTransaction, type Base } from '../db.ts';
import { AnomalieIntegrite } from './anomalie.ts';
import { hmac, hmacValide } from './signature.ts';

export type Couche = '—' | '2' | '3' | 'humain';
export type TypeEntree = 'decision' | 'sortie' | 'reseau' | 'evenement';
export type NouvelleEntree = {
  tacheId: string; type: TypeEntree; outil?: string | null; commande: string; couche: Couche;
  decision: string; decideur: string; raison: string; toolUseId?: string | null;
};
export type EntreeJournal = NouvelleEntree & { id: number; horodatage: string; empreinte: string };

type Ligne = {
  id: number; tache_id: string; horodatage: string; type: TypeEntree; outil: string | null; commande: string;
  couche: Couche; decision: string; decideur: string; raison: string; tool_use_id: string | null;
  empreinte_prec: string; empreinte: string;
};
type Tete = { nombre: number; empreinte: string; signature: string };

const GENESE = '0'.repeat(64);

// Chaîne HMAC : chaque entrée signe la précédente. La tête signée détecte la suppression des dernières entrées.
const donnees = (prec: string, horodatage: string, e: NouvelleEntree) =>
  JSON.stringify([prec, e.tacheId, horodatage, e.type, e.outil ?? null, e.commande, e.couche, e.decision, e.decideur, e.raison, e.toolUseId ?? null]);
const donneesTete = (nombre: number, empreinte: string) => `${nombre}:${empreinte}`;

const versEntree = (l: Ligne): EntreeJournal => ({
  id: l.id, tacheId: l.tache_id, horodatage: l.horodatage, type: l.type, outil: l.outil, commande: l.commande, couche: l.couche,
  decision: l.decision, decideur: l.decideur, raison: l.raison, toolUseId: l.tool_use_id, empreinte: l.empreinte,
});

const lireTete = (db: Base) => db.prepare('SELECT nombre, empreinte, signature FROM journal_tete WHERE id = 1').get() as Tete | undefined;

export function ajouterAuJournal(db: Base, cle: Buffer, e: NouvelleEntree): EntreeJournal {
  return enTransaction(db, () => {
    const tete = lireTete(db);
    const prec = tete?.empreinte ?? GENESE;
    const nombre = (tete?.nombre ?? 0) + 1;
    const horodatage = new Date().toISOString();
    const empreinte = hmac(cle, donnees(prec, horodatage, e));
    const r = db
      .prepare('INSERT INTO journal (tache_id, horodatage, type, outil, commande, couche, decision, decideur, raison, tool_use_id, empreinte_prec, empreinte) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.tacheId, horodatage, e.type, e.outil ?? null, e.commande, e.couche, e.decision, e.decideur, e.raison, e.toolUseId ?? null, prec, empreinte);
    db.prepare('INSERT INTO journal_tete (id, nombre, empreinte, signature) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, empreinte = excluded.empreinte, signature = excluded.signature')
      .run(nombre, empreinte, hmac(cle, donneesTete(nombre, empreinte)));
    return { ...e, id: Number(r.lastInsertRowid), horodatage, empreinte };
  });
}

export function verifierJournal(db: Base, cle: Buffer): void {
  let prec = GENESE;
  let nombre = 0;
  for (const l of db.prepare('SELECT * FROM journal ORDER BY id').all() as Ligne[]) {
    if (l.empreinte_prec !== prec || !hmacValide(cle, donnees(prec, l.horodatage, versEntree(l)), l.empreinte))
      throw new AnomalieIntegrite('journal', `journal des commandes altéré à l’entrée ${l.id}`);
    prec = l.empreinte;
    nombre++;
  }
  const tete = lireTete(db);
  if (nombre === 0 && !tete) return;
  if (!tete || tete.nombre !== nombre || tete.empreinte !== prec || !hmacValide(cle, donneesTete(tete.nombre, tete.empreinte), tete.signature))
    throw new AnomalieIntegrite('journal', 'journal des commandes tronqué : des entrées ont été supprimées');
}

export function lireJournal(db: Base, tacheId?: string): EntreeJournal[] {
  const lignes = tacheId
    ? db.prepare('SELECT * FROM journal WHERE tache_id = ? ORDER BY id').all(tacheId)
    : db.prepare('SELECT * FROM journal ORDER BY id').all();
  return (lignes as Ligne[]).map(versEntree);
}
