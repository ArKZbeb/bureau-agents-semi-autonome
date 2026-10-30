import type { Base } from '../db.ts';

export type Seuils = { couvertureLignes: number };

// Seuils gardés par l'orchestrateur : jamais lus dans le dépôt, donc hors de portée de l'implémenteur.
export function lireSeuils(db: Base, projet: string, defaut: number): Seuils {
  const l = db.prepare('SELECT couverture_lignes AS c FROM seuils_projets WHERE projet = ?').get(projet) as { c: number } | undefined;
  return { couvertureLignes: l?.c ?? defaut };
}

export function definirSeuils(db: Base, projet: string, s: Seuils): void {
  if (!Number.isInteger(s.couvertureLignes) || s.couvertureLignes < 0 || s.couvertureLignes > 100) throw new Error('seuil de couverture attendu : entier entre 0 et 100');
  db.prepare('INSERT INTO seuils_projets (projet, couverture_lignes) VALUES (?, ?) ON CONFLICT (projet) DO UPDATE SET couverture_lignes = excluded.couverture_lignes')
    .run(projet, s.couvertureLignes);
}
