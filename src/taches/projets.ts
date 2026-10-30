import fs from 'node:fs';
import path from 'node:path';
import { enTransaction, type Base } from '../db.ts';
import { definirSeuils, lireSeuils } from './seuils.ts';

export type Detection = {
  chemin: string; nomPropose: string; git: boolean;
  dotnet: { solution: string | null; projets: number; projetsTests: number } | null;
  angular: { fichier: string } | null;
};
export type Projet = { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number; relieLe: string };

const IGNORES = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', '.angular']);
const PROFONDEUR_MAX = 4;
const ENTREES_MAX = 10_000;
const NOM = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;

// Noms de fichiers seulement : le contenu du dossier est de la donnée et n'est jamais lu ; aucun lien symbolique suivi.
export function detecterProjet(chemin: string): Detection {
  if (!path.isAbsolute(chemin)) throw new Error('chemin absolu attendu');
  const stat = fs.lstatSync(chemin, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) throw new Error(`dossier introuvable : ${chemin}`);
  const solutions: string[] = [];
  const csproj: string[] = [];
  const angular: string[] = [];
  let vus = 0;
  const file: [string, number][] = [['', 0]];
  while (file.length && vus < ENTREES_MAX) {
    const [rel, niveau] = file.shift()!;
    for (const e of fs.readdirSync(path.join(chemin, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++vus > ENTREES_MAX) break;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!IGNORES.has(e.name) && niveau + 1 < PROFONDEUR_MAX) file.push([r, niveau + 1]); continue; }
      if (!e.isFile()) continue;
      if (/\.slnx?$/i.test(e.name)) solutions.push(r);
      else if (/\.csproj$/i.test(e.name)) csproj.push(e.name);
      else if (e.name === 'angular.json') angular.push(r);
    }
  }
  return {
    chemin, nomPropose: path.basename(chemin), git: fs.existsSync(path.join(chemin, '.git')),
    dotnet: solutions.length || csproj.length
      ? { solution: solutions[0] ?? null, projets: csproj.length, projetsTests: csproj.filter(n => /tests?\.csproj$/i.test(n)).length }
      : null,
    angular: angular.length ? { fichier: angular[0] } : null,
  };
}

type Ligne = { nom: string; chemin: string; budget_usd: number; relie_le: string };
const versProjet = (db: Base, l: Ligne, defaut: number): Projet =>
  ({ nom: l.nom, chemin: l.chemin, budgetUsd: l.budget_usd, couvertureLignes: lireSeuils(db, l.nom, defaut).couvertureLignes, relieLe: l.relie_le });

export function relierProjet(db: Base, p: { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number }): Projet {
  if (!NOM.test(p.nom)) throw new Error('nom de projet invalide (lettres, chiffres, espace, . _ -, 60 caractères au plus)');
  if (!Number.isFinite(p.budgetUsd) || p.budgetUsd <= 0) throw new Error('budget par tâche attendu : nombre positif');
  const d = detecterProjet(p.chemin);
  if (!d.git) throw new Error(`${p.chemin} n’est pas un dépôt Git`);
  if (!d.dotnet && !d.angular) throw new Error(`${p.chemin} : aucune stack .NET ou Angular détectée`);
  return enTransaction(db, () => {
    if (db.prepare('SELECT 1 FROM projets WHERE nom = ? OR chemin = ?').get(p.nom, p.chemin)) throw new Error(`projet déjà relié : ${p.nom}`);
    definirSeuils(db, p.nom, { couvertureLignes: p.couvertureLignes });
    db.prepare('INSERT INTO projets (nom, chemin, budget_usd, relie_le) VALUES (?, ?, ?, ?)').run(p.nom, p.chemin, p.budgetUsd, new Date().toISOString());
    return versProjet(db, db.prepare('SELECT * FROM projets WHERE nom = ?').get(p.nom) as Ligne, p.couvertureLignes);
  });
}

export function listerProjets(db: Base, couvertureDefaut: number): Projet[] {
  return (db.prepare('SELECT * FROM projets ORDER BY nom').all() as Ligne[]).map(l => versProjet(db, l, couvertureDefaut));
}

export function lireProjet(db: Base, nom: string, couvertureDefaut: number): Projet | null {
  const l = db.prepare('SELECT * FROM projets WHERE nom = ?').get(nom) as Ligne | undefined;
  return l ? versProjet(db, l, couvertureDefaut) : null;
}
