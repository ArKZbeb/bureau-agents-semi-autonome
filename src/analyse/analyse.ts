import { couvertureLignesModifiees, lireCobertura, type Couverture } from './cobertura.ts';
import { lignesModifiees } from './diff.ts';
import { lireDotnetVulnerables, lireGitleaks, lireNpmAudit, lireSemgrep, lireTrx, type Constat } from './rapports.ts';
import { signesDeTriche } from './triche.ts';

export const OUTILS = ['tests_dotnet', 'audit_dotnet', 'tests_angular', 'audit_npm', 'semgrep', 'gitleaks'] as const;
export type NomOutil = (typeof OUTILS)[number];
export type StatutOutil = 'ok' | 'echec' | 'absent' | 'non_applicable';
export type Analyse = {
  sha: string; base: string; outils: Record<NomOutil | 'couverture', StatutOutil>;
  tests: { total: number; echecs: number } | null; couverture: Couverture | null; constats: Constat[]; signalements: string[];
};

export const LIBELLES_OUTILS: Record<NomOutil | 'couverture', string> = {
  tests_dotnet: 'dotnet test', audit_dotnet: 'dotnet list package --vulnerable', tests_angular: 'ng test', audit_npm: 'npm audit',
  semgrep: 'Semgrep', gitleaks: 'gitleaks', couverture: 'couverture des lignes modifiées',
};

// Fichiers de /mesures (mesurer.sh) puis de /workspace/analyse (tester.sh) à relire.
export const FICHIERS_MESURES = ['sha', 'diff.patch', ...['audit_npm', 'semgrep', 'gitleaks'].flatMap(o => [`${o}.code`, `${o}.na`]), 'npm-audit.json', 'semgrep.json', 'gitleaks.json'];
export const FICHIERS_TESTS = [
  ...['tests_dotnet', 'audit_dotnet', 'tests_angular'].flatMap(o => [`${o}.code`, `${o}.na`]),
  'dotnet.trx', 'dotnet.cobertura.xml', 'dotnet-vulnerables.json', 'angular.cobertura.xml',
];
export const FICHIERS_ANALYSE = [...FICHIERS_MESURES, ...FICHIERS_TESTS];

// Code 3 des scripts : mesure impossible (cible ambiguë, base invalide...), distinct d'un échec de tests.
const MESURE_IMPOSSIBLE = 3;

const RAPPORTS: Partial<Record<NomOutil, [string, (t: string) => Constat[] | null]>> = {
  audit_dotnet: ['dotnet-vulnerables.json', lireDotnetVulnerables], audit_npm: ['npm-audit.json', lireNpmAudit],
  semgrep: ['semgrep.json', lireSemgrep], gitleaks: ['gitleaks.json', lireGitleaks],
};

export function assemblerAnalyse(base: string, fichiers: Record<string, string | null>): Analyse {
  const lu = (nom: string) => fichiers[nom] ?? null;
  const constats: Constat[] = [];
  const statut = (o: NomOutil): StatutOutil => {
    if (lu(`${o}.na`) !== null) return 'non_applicable';
    const code = lu(`${o}.code`);
    if (code === null || !/^\s*\d+\s*$/.test(code)) return 'absent';
    const rapport = RAPPORTS[o];
    if (Number(code) === MESURE_IMPOSSIBLE) return 'absent';
    if (rapport) {
      // Pour ces outils, un code non nul est une erreur de l'outil, pas un constat.
      if (Number(code) !== 0) return 'absent';
      const texte = lu(rapport[0]);
      const c = texte === null ? null : rapport[1](texte);
      if (c === null) return 'absent';
      constats.push(...c);
      return 'ok';
    }
    if (Number(code) !== 0) return 'echec';
    // Tests .NET « réussis » sans TRX lisible : la mesure manque.
    if (o === 'tests_dotnet' && lireTrx(lu('dotnet.trx') ?? '') === null) return 'absent';
    return 'ok';
  };
  const outils = Object.fromEntries(OUTILS.map(o => [o, statut(o)])) as Record<NomOutil, StatutOutil>;

  const trx = lireTrx(lu('dotnet.trx') ?? '');
  const stacksTestees = (['tests_dotnet', 'tests_angular'] as const).filter(o => outils[o] === 'ok' || outils[o] === 'echec');
  const couvertures = [
    outils.tests_dotnet === 'ok' || outils.tests_dotnet === 'echec' ? lu('dotnet.cobertura.xml') : null,
    outils.tests_angular === 'ok' || outils.tests_angular === 'echec' ? lu('angular.cobertura.xml') : null,
  ].filter((x): x is string => x !== null).map(lireCobertura).filter(c => c.size > 0); // rapport illisible = aucune classe
  const toutesNonApplicables = outils.tests_dotnet === 'non_applicable' && outils.tests_angular === 'non_applicable';
  const statutCouverture: StatutOutil = toutesNonApplicables ? 'non_applicable' : stacksTestees.length && couvertures.length ? 'ok' : 'absent';
  const patch = lu('diff.patch') ?? '';

  return {
    sha: (lu('sha') ?? '').trim(),
    base,
    outils: { ...outils, couverture: statutCouverture },
    tests: trx,
    couverture: statutCouverture === 'ok' ? couvertureLignesModifiees(lignesModifiees(patch), couvertures) : null,
    constats,
    signalements: signesDeTriche(patch),
  };
}
