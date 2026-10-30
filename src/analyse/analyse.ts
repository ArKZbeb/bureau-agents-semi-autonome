import { couvertureLignesModifiees, lireCobertura, signalementsCouverture, type Couverture } from './cobertura.ts';
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
export const FICHIERS_MESURES = ['sha', 'diff.patch', 'stack_dotnet.na', 'stack_angular.na', ...['audit_npm', 'semgrep', 'gitleaks'].flatMap(o => [`${o}.code`, `${o}.na`]), 'npm-audit.json', 'semgrep.json', 'gitleaks.json'];
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

const aTourne = (s: StatutOutil) => s === 'ok' || s === 'echec';

// Outils de tester.sh dont la non-applicabilité doit être confirmée par mesurer.sh (stack absente du dépôt) :
// tester.sh exécute le code du dépôt, qui peut écrire un .na pour échapper à une mesure.
const STACK: Partial<Record<NomOutil, string>> = {
  tests_dotnet: 'stack_dotnet.na', audit_dotnet: 'stack_dotnet.na', tests_angular: 'stack_angular.na',
};

export function assemblerAnalyse(base: string, fichiers: Record<string, string | null>): Analyse {
  const lu = (nom: string) => fichiers[nom] ?? null;
  const statut = (o: NomOutil): StatutOutil => {
    if (lu(`${o}.na`) !== null) {
      const stack = STACK[o];
      return stack === undefined || lu(stack) !== null ? 'non_applicable' : 'absent';
    }
    const code = lu(`${o}.code`);
    if (code === null || !/^\s*\d+\s*$/.test(code)) return 'absent';
    if (Number(code) === MESURE_IMPOSSIBLE) return 'absent';
    const rapport = RAPPORTS[o];
    if (rapport) {
      // Pour ces outils, un code non nul est une erreur de l'outil, pas un constat.
      if (Number(code) !== 0) return 'absent';
      const texte = lu(rapport[0]);
      return texte !== null && rapport[1](texte) !== null ? 'ok' : 'absent';
    }
    if (Number(code) !== 0) return 'echec';
    // Tests .NET « réussis » sans TRX lisible : la mesure manque.
    if (o === 'tests_dotnet' && lireTrx(lu('dotnet.trx') ?? '') === null) return 'absent';
    return 'ok';
  };
  const outils = Object.fromEntries(OUTILS.map(o => [o, statut(o)])) as Record<NomOutil, StatutOutil>;

  // Mesures de mesurer.sh interrompu (sha incomplet) : les mesures statiques ne sont pas fiables.
  const shaValide = /^[0-9a-f]{40}$/.test((lu('sha') ?? '').trim());
  if (!shaValide) for (const o of ['semgrep', 'gitleaks', 'audit_npm'] as const) outils[o] = 'absent';

  const trx = lireTrx(lu('dotnet.trx') ?? '');
  const patch = lu('diff.patch');
  const stacks: [NomOutil, string][] = [['tests_dotnet', 'dotnet.cobertura.xml'], ['tests_angular', 'angular.cobertura.xml']];
  const testees = stacks.filter(([o]) => aTourne(outils[o]));
  // Chaque stack testée doit avoir un Cobertura lisible (au moins une classe) : sinon une stack entière n'est pas mesurée.
  const couvertures = testees.map(([, f]) => lireCobertura(lu(f) ?? '')).filter(c => c.size > 0);
  const toutesNonApplicables = outils.tests_dotnet === 'non_applicable' && outils.tests_angular === 'non_applicable';
  const couvertureMesurable = shaValide && patch !== null && testees.length > 0 && couvertures.length === testees.length;
  const statutCouverture: StatutOutil = toutesNonApplicables && shaValide ? 'non_applicable' : couvertureMesurable ? 'ok' : 'absent';

  const constats: Constat[] = [];
  for (const o of OUTILS) {
    const rapport = RAPPORTS[o];
    if (rapport && outils[o] === 'ok') constats.push(...(rapport[1](lu(rapport[0]) ?? '') ?? []));
  }

  const modifiees = lignesModifiees(patch ?? '');
  const couverture = statutCouverture === 'ok' ? couvertureLignesModifiees(modifiees, couvertures) : null;
  return {
    sha: (lu('sha') ?? '').trim(),
    base,
    outils: { ...outils, couverture: statutCouverture },
    tests: trx,
    couverture,
    constats,
    signalements: [...signesDeTriche(patch ?? ''), ...(couverture ? signalementsCouverture(modifiees, couvertures, couverture) : [])],
  };
}
