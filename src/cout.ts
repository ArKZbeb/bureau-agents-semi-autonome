import type { Tarifs } from './config.ts';

export type Usage = {
  input_tokens?: number | null; output_tokens?: number | null;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
};

export function coutUsd(u: Usage, modele: string, tarifs: Tarifs): number {
  // ponytail: un modèle absent de la table est facturé au tarif le plus cher ; ajouter son tarif quand il sert
  const t = Object.entries(tarifs).find(([id]) => modele.startsWith(id))?.[1]
    ?? Object.values(tarifs).reduce((a, b) => (b.sortie > a.sortie ? b : a));
  const entree = (u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return (entree * t.entree + (u.output_tokens ?? 0) * t.sortie) / 1e6;
}
