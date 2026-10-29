import { enTransaction, type Base } from '../db.ts';
import { AnomalieIntegrite } from './anomalie.ts';
import { hmac, hmacValide, sha256 } from './signature.ts';

export type TypeArtefact = 'spec' | 'plan' | 'criteres' | 'rapport' | 'verdict';
export type Artefact = { id: number; tacheId: string; type: TypeArtefact; contenu: string; sha256: string; creeLe: string };

type Ligne = { id: number; tache_id: string; type: TypeArtefact; contenu: string; sha256: string; hmac: string; cree_le: string };
type Tete = { type: string; nombre: number; empreinte: string; signature: string };

// La signature lie l'empreinte à la tâche et au type : un artefact ne peut pas être déplacé.
const donneesSignees = (tacheId: string, type: string, empreinte: string) => `${tacheId}\n${type}\n${empreinte}`;
// La tête signée par (tâche, type) détecte une version supprimée, donc tout retour à une version antérieure.
const donneesTete = (tacheId: string, type: string, nombre: number, empreinte: string) => `tete\n${tacheId}\n${type}\n${nombre}\n${empreinte}`;

export function enregistrerArtefact(db: Base, cle: Buffer, tacheId: string, type: TypeArtefact, contenu: string): Artefact {
  return enTransaction(db, () => {
    const lignes = lignesDuType(db, tacheId, type);
    verifierType(db, cle, tacheId, type, lignes);
    const empreinte = sha256(contenu);
    const creeLe = new Date().toISOString();
    const r = db
      .prepare('INSERT INTO artefacts (tache_id, type, contenu, sha256, hmac, cree_le) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tacheId, type, contenu, empreinte, hmac(cle, donneesSignees(tacheId, type, empreinte)), creeLe);
    const nombre = lignes.length + 1;
    db.prepare('INSERT INTO artefacts_tete (tache_id, type, nombre, empreinte, signature) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tache_id, type) DO UPDATE SET nombre = excluded.nombre, empreinte = excluded.empreinte, signature = excluded.signature')
      .run(tacheId, type, nombre, empreinte, hmac(cle, donneesTete(tacheId, type, nombre, empreinte)));
    return { id: Number(r.lastInsertRowid), tacheId, type, contenu, sha256: empreinte, creeLe };
  });
}

function verifier(cle: Buffer, l: Ligne): Artefact {
  const nom = `${l.type} de ${l.tache_id}`;
  if (sha256(l.contenu) !== l.sha256)
    throw new AnomalieIntegrite(nom, `${nom} modifié après validation (empreinte ${l.sha256.slice(0, 4)}… attendue)`);
  if (!hmacValide(cle, donneesSignees(l.tache_id, l.type, l.sha256), l.hmac))
    throw new AnomalieIntegrite(nom, `${nom} : signature invalide`);
  return { id: l.id, tacheId: l.tache_id, type: l.type, contenu: l.contenu, sha256: l.sha256, creeLe: l.cree_le };
}

const lignesDuType = (db: Base, tacheId: string, type: string) =>
  db.prepare('SELECT * FROM artefacts WHERE tache_id = ? AND type = ? ORDER BY id').all(tacheId, type) as Ligne[];

function verifierType(db: Base, cle: Buffer, tacheId: string, type: string, lignes: Ligne[]): void {
  const tete = db.prepare('SELECT type, nombre, empreinte, signature FROM artefacts_tete WHERE tache_id = ? AND type = ?').get(tacheId, type) as Tete | undefined;
  if (lignes.length === 0 && !tete) return;
  const derniere = lignes.at(-1);
  if (!tete || tete.nombre !== lignes.length || tete.empreinte !== derniere?.sha256
    || !hmacValide(cle, donneesTete(tacheId, type, tete.nombre, tete.empreinte), tete.signature)) {
    const nom = `${type} de ${tacheId}`;
    throw new AnomalieIntegrite(nom, `${nom} : version supprimée ou registre altéré`);
  }
}

export function lireArtefact(db: Base, cle: Buffer, tacheId: string, type: TypeArtefact): Artefact | undefined {
  const lignes = lignesDuType(db, tacheId, type);
  const derniere = lignes.at(-1);
  const artefact = derniere ? verifier(cle, derniere) : undefined;
  verifierType(db, cle, tacheId, type, lignes);
  return artefact;
}

export function verifierArtefactsTache(db: Base, cle: Buffer, tacheId: string): void {
  const lignes = db.prepare('SELECT * FROM artefacts WHERE tache_id = ? ORDER BY id').all(tacheId) as Ligne[];
  for (const l of lignes) verifier(cle, l);
  const tetes = db.prepare('SELECT type FROM artefacts_tete WHERE tache_id = ?').all(tacheId) as { type: string }[];
  for (const type of new Set([...lignes.map(l => l.type), ...tetes.map(t => t.type)]))
    verifierType(db, cle, tacheId, type, lignes.filter(l => l.type === type));
}
