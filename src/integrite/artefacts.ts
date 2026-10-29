import type { Base } from '../db.ts';
import { AnomalieIntegrite } from './anomalie.ts';
import { hmac, hmacValide, sha256 } from './signature.ts';

export type TypeArtefact = 'spec' | 'plan' | 'criteres' | 'rapport' | 'verdict';
export type Artefact = { id: number; tacheId: string; type: TypeArtefact; contenu: string; sha256: string; creeLe: string };

type Ligne = { id: number; tache_id: string; type: TypeArtefact; contenu: string; sha256: string; hmac: string; cree_le: string };

// La signature lie l'empreinte à la tâche et au type : un artefact ne peut pas être déplacé.
const donneesSignees = (tacheId: string, type: string, empreinte: string) => `${tacheId}\n${type}\n${empreinte}`;

export function enregistrerArtefact(db: Base, cle: Buffer, tacheId: string, type: TypeArtefact, contenu: string): Artefact {
  const empreinte = sha256(contenu);
  const creeLe = new Date().toISOString();
  const r = db
    .prepare('INSERT INTO artefacts (tache_id, type, contenu, sha256, hmac, cree_le) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tacheId, type, contenu, empreinte, hmac(cle, donneesSignees(tacheId, type, empreinte)), creeLe);
  return { id: Number(r.lastInsertRowid), tacheId, type, contenu, sha256: empreinte, creeLe };
}

function verifier(cle: Buffer, l: Ligne): Artefact {
  const nom = `${l.type} de ${l.tache_id}`;
  if (sha256(l.contenu) !== l.sha256)
    throw new AnomalieIntegrite(nom, `${nom} modifié après validation (empreinte ${l.sha256.slice(0, 4)}… attendue)`);
  if (!hmacValide(cle, donneesSignees(l.tache_id, l.type, l.sha256), l.hmac))
    throw new AnomalieIntegrite(nom, `${nom} : signature invalide`);
  return { id: l.id, tacheId: l.tache_id, type: l.type, contenu: l.contenu, sha256: l.sha256, creeLe: l.cree_le };
}

export function lireArtefact(db: Base, cle: Buffer, tacheId: string, type: TypeArtefact): Artefact | undefined {
  const l = db.prepare('SELECT * FROM artefacts WHERE tache_id = ? AND type = ? ORDER BY id DESC LIMIT 1').get(tacheId, type) as Ligne | undefined;
  return l ? verifier(cle, l) : undefined;
}

export function verifierArtefactsTache(db: Base, cle: Buffer, tacheId: string): void {
  for (const l of db.prepare('SELECT * FROM artefacts WHERE tache_id = ?').all(tacheId) as Ligne[]) verifier(cle, l);
}
