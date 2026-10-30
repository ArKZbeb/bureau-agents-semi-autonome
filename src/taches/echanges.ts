import type { Base } from '../db.ts';

export type Auteur = 'cadreur' | 'moi';
export type Echange = { auteur: Auteur; texte: string; creeLe: string };
export type Proposition = { spec: string; criteres: string[]; plan: string };

export function ajouterEchange(db: Base, tacheId: string, auteur: Auteur, texte: string): void {
  db.prepare('INSERT INTO echanges (tache_id, auteur, texte, cree_le) VALUES (?, ?, ?, ?)').run(tacheId, auteur, texte, new Date().toISOString());
}

export const listerEchanges = (db: Base, tacheId: string): Echange[] =>
  (db.prepare('SELECT auteur, texte, cree_le AS creeLe FROM echanges WHERE tache_id = ? ORDER BY id').all(tacheId) as Echange[]);

// Brouillon du cadreur : rien n'est signé tant que je n'ai pas validé.
export function enregistrerProposition(db: Base, tacheId: string, p: Proposition): void {
  db.prepare('INSERT INTO propositions (tache_id, contenu, cree_le) VALUES (?, ?, ?) ON CONFLICT (tache_id) DO UPDATE SET contenu = excluded.contenu, cree_le = excluded.cree_le')
    .run(tacheId, JSON.stringify(p), new Date().toISOString());
}

export function lireProposition(db: Base, tacheId: string): Proposition | null {
  const l = db.prepare('SELECT contenu FROM propositions WHERE tache_id = ?').get(tacheId) as { contenu: string } | undefined;
  return l ? (JSON.parse(l.contenu) as Proposition) : null;
}

export function supprimerProposition(db: Base, tacheId: string): void {
  db.prepare('DELETE FROM propositions WHERE tache_id = ?').run(tacheId);
}
