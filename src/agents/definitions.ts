import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Config, NomModele } from '../config.ts';
import type { Agent } from '../conteneurs/execution.ts';
import type { Etape } from '../taches/etats.ts';

export type EtapeAgent = Exclude<Etape, 'validation'>;

// Objet plat (pas d'union à la racine) : --json-schema attend un schéma objet ; la cohérence est vérifiée ici.
// Les documents eux-mêmes sont écrits par le cadreur dans /workspace/cadrage (spec.md, plan.md).
export const SortieCadreur = z.object({
  type: z.enum(['questions', 'proposition']),
  questions: z.array(z.string().min(1)).optional(),
}).refine(s => s.type !== 'questions' || (s.questions?.length ?? 0) > 0);
export const SortiePatronPlan = z.object({ verdict: z.enum(['ok', 'objection']), note: z.string().min(1) });
export const SortieImplementeur = z.object({ resume: z.string().min(1) });
export const SortieReviewer = z.object({ rapport: z.string().min(1) });
export const SortiePatronCode = z.object({ note: z.string().min(1) });
export const SortieQa = z.object({
  verdict: z.enum(['go', 'no_go']),
  criteres: z.array(z.object({ numero: z.number().int().min(1), rempli: z.boolean(), preuve: z.string() })),
});

export type Definition = {
  agent: Exclude<NomModele, 'controleur'>; fichier: string; schema: z.ZodType;
  espace: 'branche' | 'copie'; maxTours: number; dureeMaxMs: number;
};

const MIN = 60_000;
export const DEFINITIONS: Record<EtapeAgent, Definition> = {
  cadrage: { agent: 'cadreur', fichier: 'cadreur.md', schema: SortieCadreur, espace: 'branche', maxTours: 80, dureeMaxMs: 30 * MIN },
  patron_plan: { agent: 'patron', fichier: 'patron-plan.md', schema: SortiePatronPlan, espace: 'copie', maxTours: 40, dureeMaxMs: 30 * MIN },
  implementation: { agent: 'implementeur', fichier: 'implementeur.md', schema: SortieImplementeur, espace: 'branche', maxTours: 200, dureeMaxMs: 60 * MIN },
  review: { agent: 'reviewer', fichier: 'reviewer.md', schema: SortieReviewer, espace: 'copie', maxTours: 80, dureeMaxMs: 30 * MIN },
  patron_code: { agent: 'patron', fichier: 'patron-code.md', schema: SortiePatronCode, espace: 'copie', maxTours: 40, dureeMaxMs: 30 * MIN },
  qa: { agent: 'qa', fichier: 'qa.md', schema: SortieQa, espace: 'copie', maxTours: 80, dureeMaxMs: 30 * MIN },
};

export function agentPour(etape: EtapeAgent, config: Config, racineDepot: string): Agent {
  const d = DEFINITIONS[etape];
  const lire = (f: string) => fs.readFileSync(path.join(racineDepot, 'agents', f), 'utf8');
  return {
    nom: d.agent, modele: config.modeles[d.agent], maxTours: d.maxTours, dureeMaxMs: d.dureeMaxMs,
    promptSysteme: `${lire('socle.md')}\n\n${lire(d.fichier)}`,
    schema: z.toJSONSchema(d.schema) as Record<string, unknown>,
  };
}

export function lireSortie<T>(schema: z.ZodType<T>, sortie: unknown): T | null {
  const r = schema.safeParse(sortie);
  return r.success ? r.data : null;
}
