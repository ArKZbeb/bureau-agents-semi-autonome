export type Severite = 'critique' | 'haute' | 'moyenne' | 'basse';
export type Constat = { outil: 'audit_npm' | 'audit_dotnet' | 'semgrep' | 'gitleaks'; severite: Severite; message: string; fichier: string | null };

type Json = any;
const json = (texte: string): Json | undefined => { try { return JSON.parse(texte); } catch { return undefined; } };
const SEVERITES: Record<string, Severite> = {
  critical: 'critique', high: 'haute', moderate: 'moyenne', medium: 'moyenne', low: 'basse', info: 'basse',
  error: 'haute', warning: 'moyenne',
};
const severite = (s: unknown): Severite => SEVERITES[String(s).toLowerCase()] ?? 'moyenne';

export function lireTrx(xml: string): { total: number; echecs: number } | null {
  const m = /<Counters\b[^>]*>/.exec(xml);
  const total = m && /\btotal="(\d+)"/.exec(m[0]);
  const echecs = m && /\bfailed="(\d+)"/.exec(m[0]);
  return total && echecs ? { total: Number(total[1]), echecs: Number(echecs[1]) } : null;
}

export function lireNpmAudit(texte: string): Constat[] | null {
  const j = json(texte);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  // Hors réseau, npm audit renvoie { message, error } : ce n'est pas une mesure, jamais « zéro constat ».
  if ('error' in j) return null;
  const v = j.vulnerabilities;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return Object.entries(v as Record<string, Json>).map(([nom, v]) => ({
    outil: 'audit_npm' as const, severite: severite(v?.severity), message: `${nom} : vulnérabilité ${v?.severity}`, fichier: null,
  }));
}

export function lireDotnetVulnerables(texte: string): Constat[] | null {
  const j = json(texte);
  if (!j || !Array.isArray(j.projects)) return null;
  const constats: Constat[] = [];
  for (const p of j.projects as Json[])
    for (const f of (p.frameworks ?? []) as Json[])
      for (const paquet of [...(f.topLevelPackages ?? []), ...(f.transitivePackages ?? [])] as Json[])
        for (const v of (paquet.vulnerabilities ?? []) as Json[])
          constats.push({ outil: 'audit_dotnet', severite: severite(v.severity), message: `${paquet.id} ${paquet.resolvedVersion} : vulnérabilité ${v.severity}`, fichier: null });
  return constats;
}

export function lireSemgrep(texte: string): Constat[] | null {
  const j = json(texte);
  if (!j || !Array.isArray(j.results)) return null;
  // Erreurs d'analyse (délais, règles en échec) : mesure incomplète, donc absente.
  if (Array.isArray(j.errors) && j.errors.length > 0) return null;
  return (j.results as Json[]).map(r => ({
    outil: 'semgrep' as const, severite: severite(r.extra?.severity), message: `${String(r.check_id).replace(/^opt\.analyse\./, '')} : ${r.extra?.message ?? ''}`.trim(),
    fichier: r.path ? `${r.path}:${r.start?.line ?? '?'}` : null,
  }));
}

// La valeur du secret n'est jamais recopiée : seulement la règle et l'emplacement.
export function lireGitleaks(texte: string): Constat[] | null {
  const j = json(texte);
  if (!Array.isArray(j)) return null;
  return (j as Json[]).map(f => ({ outil: 'gitleaks' as const, severite: 'critique' as const, message: `secret détecté (${f.RuleID})`, fichier: `${f.File}:${f.StartLine}` }));
}
