export type Couverture = { couvertes: number; total: number; pourcentage: number | null };

const RACINE_DEPOT = '/workspace/projet/';

// Un `filename` absolu est gardé ; un `filename` relatif est relatif au premier <source> (istanbul / Angular).
const normaliser = (chemin: string, sources: string[]): string => {
  let c = chemin.replace(/\\/g, '/');
  if (!c.startsWith('/') && sources[0]) c = sources[0] + c.replace(/^\.\//, '');
  return c.startsWith(RACINE_DEPOT) ? c.slice(RACINE_DEPOT.length) : c.replace(/^\.\//, '');
};

// Lecture volontairement minimale (aucune dépendance XML) : attributs filename, number et hits (dans un ordre quelconque).
export function lireCobertura(xml: string): Map<string, Map<number, number>> {
  const sources = [...xml.matchAll(/<source>([^<]*)<\/source>/g)].map(m => m[1].trim().replace(/\\/g, '/').replace(/\/?$/, '/'));
  const resultat = new Map<string, Map<number, number>>();
  for (const bloc of xml.matchAll(/<class\b([^>]*?)(?:\/>|>([\s\S]*?)<\/class>)/g)) {
    const nom = /\bfilename="([^"]+)"/.exec(bloc[1]);
    if (!nom) continue;
    const chemin = normaliser(nom[1], sources);
    const lignes = resultat.get(chemin) ?? new Map<number, number>();
    for (const l of (bloc[2] ?? '').matchAll(/<line\b([^>]*)>/g)) {
      const n = /\bnumber="(\d+)"/.exec(l[1]);
      const h = /\bhits="(\d+)"/.exec(l[1]);
      if (!n || !h) continue;
      lignes.set(Number(n[1]), Math.max(lignes.get(Number(n[1])) ?? 0, Number(h[1])));
    }
    resultat.set(chemin, lignes);
  }
  return resultat;
}

// dotnet-coverage instrumente aussi les assemblies de test : leurs lignes gonfleraient le pourcentage.
export const estFichierDeTest = (chemin: string): boolean =>
  /(^|\/)(tests?|__tests__|[^/]*\.Tests?)\//i.test(chemin) || /(Tests?\.cs|\.(spec|test)\.[cm]?[jt]sx?)$/.test(chemin);

export function couvertureLignesModifiees(modifiees: Map<string, Set<number>>, couvertures: Map<string, Map<number, number>>[]): Couverture {
  let total = 0;
  let couvertes = 0;
  for (const [chemin, lignes] of modifiees) {
    if (estFichierDeTest(chemin)) continue;
    for (const n of lignes) {
      const passages = couvertures.map(c => c.get(chemin)?.get(n)).filter((h): h is number => h !== undefined);
      if (!passages.length) continue;
      total++;
      if (passages.some(h => h > 0)) couvertes++;
    }
  }
  return { couvertes, total, pourcentage: total ? Math.round((couvertes / total) * 100) : null };
}

/**
 * Lignes modifiées non instrumentées ignorées (choix 3) : ce qui échappe ainsi à la mesure est au moins signalé.
 * Fichiers source (.cs, .ts) modifiés hors tests absents de toute Cobertura ; aucune ligne modifiée mesurable.
 */
export function signalementsCouverture(modifiees: Map<string, Set<number>>, couvertures: Map<string, Map<number, number>>[], couverture: Couverture): string[] {
  const sources = [...modifiees.keys()].filter(c => /\.(cs|ts)$/.test(c) && !estFichierDeTest(c));
  const absents = sources.filter(c => !couvertures.some(cob => cob.has(c)));
  const s: string[] = [];
  if (absents.length) s.push(`${absents.length} fichier(s) source modifié(s) absent(s) de la couverture`);
  if (sources.length && couverture.total === 0) s.push('couverture non mesurable sur les lignes modifiées');
  return s;
}
