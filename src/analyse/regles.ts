import type { z } from 'zod';
import type { SortieQa } from '../agents/definitions.ts';
import type { Seuils } from '../taches/seuils.ts';
import { LIBELLES_OUTILS, OUTILS, type Analyse } from './analyse.ts';

const MESURES = new Set<unknown>(['ok', 'echec', 'non_applicable']);

// Règles automatiques de la spec : l'agent QA peut dire no-go, jamais faire passer une mesure manquante ou mauvaise.
export function reglesQa(a: Analyse | null, seuils: Seuils, sortieQa: z.infer<typeof SortieQa>, criteres: string[]): { verdict: 'go' | 'no_go'; declenchees: string[] } {
  const d: string[] = [];
  if (!a) d.push('analyse absente : aucune mesure');
  else {
    // Tout statut autre qu'une mesure (ok, echec) ou une non-applicabilité est une mesure manquante, même inattendu.
    for (const o of [...OUTILS, 'couverture'] as const) if (!MESURES.has(a.outils[o])) d.push(`outil non exécuté : ${LIBELLES_OUTILS[o]}`);
    if (a.outils.tests_dotnet === 'echec') d.push(a.tests ? `tests en échec (${a.tests.echecs} sur ${a.tests.total})` : 'tests en échec');
    if (a.outils.tests_angular === 'echec') d.push('tests en échec (ng test)');
    for (const c of a.constats) if (c.severite === 'critique' || c.severite === 'haute') d.push(`faille ${c.severite} : ${c.message}${c.fichier ? ` (${c.fichier})` : ''}`);
    // Pourcentage null = non mesurable ou non applicable : pas de règle de seuil. Zéro reste une mesure.
    const p = a.couverture?.pourcentage;
    if (p !== null && p !== undefined && p < seuils.couvertureLignes) d.push(`couverture des lignes modifiées ${p} % < ${seuils.couvertureLignes} %`);
    // Un fichier source modifié qu'aucun test ne charge échappe au pourcentage (choix 3) : no-go, liste illisible comprise.
    const hors: unknown = a.couverture?.sourcesHorsCouverture;
    if (a.couverture && (!Array.isArray(hors) || !hors.every(f => typeof f === 'string'))) d.push('couverture : fichiers source hors couverture inconnus');
    else if (Array.isArray(hors) && hors.length)
      d.push(`couverture : ${hors.length} fichier(s) source modifié(s) hors couverture (${hors.slice(0, 5).join(', ')}${hors.length > 5 ? ', …' : ''})`);
  }
  if (sortieQa.verdict !== 'go') d.push('verdict du QA : no-go');
  const remplis = new Set(sortieQa.criteres.filter(c => c.rempli).map(c => c.numero));
  criteres.forEach((_, i) => { if (!remplis.has(i + 1)) d.push(`critère ${i + 1} non rempli`); });
  if (criteres.length === 0) d.push('aucun critère d’acceptation validé');
  return { verdict: d.length ? 'no_go' : 'go', declenchees: d };
}
