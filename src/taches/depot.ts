import { enTransaction, type Base } from '../db.ts';
import { transition, type Etape, type EtatTache, type Evenement, type Statut } from './etats.ts';

export type Reprise = { sessionId: string; mode: 'defer' | 'message'; message: string | null; empreinteTranscript: string };
export type Tache = EtatTache & {
  id: string; projet: string; titre: string; cheminProjet: string; budgetUsd: number; depenseUsd: number; reprise: Reprise | null;
};
export type NouvelleTache = Pick<Tache, 'id' | 'projet' | 'titre' | 'cheminProjet' | 'budgetUsd'>;

type Ligne = {
  id: string; projet: string; titre: string; chemin_projet: string; etape: Etape; statut: Statut; raison: string | null;
  echanges_plan: number; essais_qa: number; budget_usd: number; depense_usd: number; reprise: string | null;
};

const maintenant = () => new Date().toISOString();

const versTache = (l: Ligne): Tache => ({
  id: l.id, projet: l.projet, titre: l.titre, cheminProjet: l.chemin_projet, etape: l.etape, statut: l.statut, raison: l.raison,
  echangesPlan: l.echanges_plan, essaisQa: l.essais_qa, budgetUsd: l.budget_usd, depenseUsd: l.depense_usd,
  reprise: l.reprise ? (JSON.parse(l.reprise) as Reprise) : null,
});

export function creerTache(db: Base, t: NouvelleTache): Tache {
  db.prepare(`INSERT INTO taches (id, projet, titre, chemin_projet, etape, statut, budget_usd, maj_le) VALUES (?, ?, ?, ?, 'cadrage', 'prete', ?, ?)`)
    .run(t.id, t.projet, t.titre, t.cheminProjet, t.budgetUsd, maintenant());
  return lireTache(db, t.id);
}

export function lireTache(db: Base, id: string): Tache {
  const l = db.prepare('SELECT * FROM taches WHERE id = ?').get(id) as Ligne | undefined;
  if (!l) throw new Error(`tâche inconnue : ${id}`);
  return versTache(l);
}

export const listerTaches = (db: Base): Tache[] => (db.prepare('SELECT * FROM taches ORDER BY id').all() as Ligne[]).map(versTache);

export function appliquer(db: Base, id: string, ev: Evenement): Tache {
  return enTransaction(db, () => {
    const e = transition(lireTache(db, id), ev);
    db.prepare('UPDATE taches SET etape = ?, statut = ?, raison = ?, echanges_plan = ?, essais_qa = ?, maj_le = ? WHERE id = ?')
      .run(e.etape, e.statut, e.raison, e.echangesPlan, e.essaisQa, maintenant(), id);
    return lireTache(db, id);
  });
}

export function definirReprise(db: Base, id: string, reprise: Reprise | null): void {
  db.prepare('UPDATE taches SET reprise = ?, maj_le = ? WHERE id = ?').run(reprise ? JSON.stringify(reprise) : null, maintenant(), id);
}

export function ajouterDepense(db: Base, id: string, usd: number): Tache {
  db.prepare('UPDATE taches SET depense_usd = depense_usd + ?, maj_le = ? WHERE id = ?').run(usd, maintenant(), id);
  return lireTache(db, id);
}

export function augmenterBudget(db: Base, id: string, usd: number): Tache {
  db.prepare('UPDATE taches SET budget_usd = budget_usd + ?, maj_le = ? WHERE id = ?').run(usd, maintenant(), id);
  return lireTache(db, id);
}

// Au démarrage, aucun conteneur ne survit : une étape « en cours » est relancée depuis son début.
export function reprendreApresRedemarrage(db: Base): string[] {
  const ids = (db.prepare(`SELECT id FROM taches WHERE statut = 'en_cours'`).all() as { id: string }[]).map(l => l.id);
  for (const id of ids) appliquer(db, id, { type: 'redemarrage' });
  return ids;
}
