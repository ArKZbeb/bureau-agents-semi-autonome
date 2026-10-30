export type Severite = 'critique' | 'haute' | 'moyenne' | 'basse';
export type Constat = { outil: 'audit_npm' | 'audit_dotnet' | 'semgrep' | 'gitleaks'; severite: Severite; message: string; fichier: string | null };

type Json = any;
const json = (texte: string): Json | undefined => { try { return JSON.parse(texte); } catch { return undefined; } };
const SEVERITES: Record<string, Severite> = {
  critical: 'critique', high: 'haute', moderate: 'moyenne', medium: 'moyenne', low: 'basse', info: 'basse',
  error: 'haute', warning: 'moyenne',
};
// Sévérité inconnue ou absente : « haute » (fail-closed).
const severite = (s: unknown): Severite => SEVERITES[String(s).toLowerCase()] ?? 'haute';
const libelle = (s: unknown): string => (typeof s === 'string' && s !== '' ? s : 'inconnue');
const objet = (x: unknown): x is Record<string, Json> => !!x && typeof x === 'object' && !Array.isArray(x);
const liste = (x: unknown): Json[] | null => (x === undefined ? [] : Array.isArray(x) ? x : null);

export function lireTrx(xml: string): { total: number; echecs: number } | null {
  const m = /<Counters\b[^>]*>/.exec(xml);
  const nombre = (nom: string) => { const r = m && new RegExp(`\\b${nom}="(\\d+)"`).exec(m[0]); return r ? Number(r[1]) : null; };
  const total = nombre('total'), echecs = nombre('failed');
  if (total === null || echecs === null) return null;
  // Erreurs, délais et abandons sont aussi des échecs.
  return { total, echecs: echecs + (nombre('error') ?? 0) + (nombre('timeout') ?? 0) + (nombre('aborted') ?? 0) };
}

export function lireNpmAudit(texte: string): Constat[] | null {
  const j = json(texte);
  if (!objet(j)) return null;
  // Hors réseau, npm audit renvoie { message, error } : ce n'est pas une mesure, jamais « zéro constat ».
  if ('error' in j) return null;
  if (!objet(j.vulnerabilities)) return null;
  const entrees = Object.entries(j.vulnerabilities);
  if (!entrees.every(([, v]) => objet(v))) return null;
  return entrees.map(([nom, v]) => ({
    outil: 'audit_npm' as const, severite: severite(v.severity), message: `${nom} : vulnérabilité ${libelle(v.severity)}`, fichier: null,
  }));
}

export function lireDotnetVulnerables(texte: string): Constat[] | null {
  const j = json(texte);
  if (!objet(j) || !Array.isArray(j.projects)) return null;
  if (Array.isArray(j.problems) && j.problems.length > 0) return null;
  const constats: Constat[] = [];
  for (const p of j.projects as Json[]) {
    if (!objet(p)) return null;
    const frameworks = liste(p.frameworks);
    if (!frameworks) return null;
    for (const f of frameworks) {
      if (!objet(f)) return null;
      const directs = liste(f.topLevelPackages), transitifs = liste(f.transitivePackages);
      if (!directs || !transitifs) return null;
      for (const paquet of [...directs, ...transitifs]) {
        if (!objet(paquet)) return null;
        const vulnerabilites = liste(paquet.vulnerabilities);
        if (!vulnerabilites) return null;
        for (const v of vulnerabilites) {
          if (!objet(v)) return null;
          constats.push({ outil: 'audit_dotnet', severite: severite(v.severity), message: `${paquet.id} ${paquet.resolvedVersion} : vulnérabilité ${libelle(v.severity)}`, fichier: null });
        }
      }
    }
  }
  return constats;
}

export function lireSemgrep(texte: string): Constat[] | null {
  const j = json(texte);
  if (!objet(j) || !Array.isArray(j.results)) return null;
  // Erreurs d'analyse (délais, règles en échec) : mesure incomplète, donc absente.
  if (Array.isArray(j.errors) && j.errors.length > 0) return null;
  if (!j.results.every(objet)) return null;
  return (j.results as Json[]).map(r => ({
    outil: 'semgrep' as const, severite: severite(r.extra?.severity), message: `${String(r.check_id).replace(/^opt\.analyse\./, '')} : ${r.extra?.message ?? ''}`.trim(),
    fichier: r.path ? `${r.path}:${r.start?.line ?? '?'}` : null,
  }));
}

// La valeur du secret n'est jamais recopiée : seulement la règle et l'emplacement.
export function lireGitleaks(texte: string): Constat[] | null {
  const j = json(texte);
  if (!Array.isArray(j)) return null;
  if (!j.every(f => objet(f) && typeof f.RuleID === 'string' && typeof f.File === 'string' && typeof f.StartLine === 'number')) return null;
  return (j as Json[]).map(f => ({ outil: 'gitleaks' as const, severite: 'critique' as const, message: `secret détecté (${f.RuleID})`, fichier: `${f.File}:${f.StartLine}` }));
}
