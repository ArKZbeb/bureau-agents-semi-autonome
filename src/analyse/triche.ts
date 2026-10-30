const FICHIER_TEST = /test|spec/i;
const TEST_RETIRE = /\[(Fact|Theory|Test)\b|\b(it|test)\(/;
const DESACTIVE = /Skip\s*=|\[Ignore|\bxit\(|\bxdescribe\(|\.skip\(|\bit\.skip\b|\bdescribe\.skip\b/;
const ISOLE = /\bfit\(|\bfdescribe\(|\bit\.only\b|\bdescribe\.only\b/;
const CONFIGURATION = /(karma\.conf|\.runsettings$|coverlet|jest\.config|vitest\.config|Directory\.Build\.props$|angular\.json$)/i;
const CONTOURNEMENT = /nosemgrep|gitleaks:allow/;
const CONFIGURATION_OUTIL = /^(\.gitleaksignore|\.gitleaks\.toml|\.semgrepignore|\.semgrep\.ya?ml|\.gitattributes)$/;
const EXCLUSION_COUVERTURE = /ExcludeFromCodeCoverage|istanbul ignore|c8 ignore|v8 ignore|codeCoverageExclude|coverletExclude|<ExcludeByAttribute|<ExcludeByFile/i;

// Signalements déterministes : ils informent le reviewer, le QA et le contrôleur, sans bloquer seuls.
export function signesDeTriche(patch: string): string[] {
  const signes: string[] = [];
  const ajouter = (s: string) => { if (!signes.includes(s)) signes.push(s); };
  let fichier: string | null = null;
  for (const ligne of patch.split('\n')) {
    if (ligne.startsWith('diff --git ')) {
      fichier = /^diff --git a\/(.+?) b\//.exec(ligne)?.[1] ?? null;
      if (fichier && CONFIGURATION.test(fichier)) ajouter(`configuration de test ou de couverture modifiée : ${fichier}`);
      if (fichier && CONFIGURATION_OUTIL.test(fichier.split('/').pop() ?? '')) ajouter(`fichier de configuration d’outil d’analyse modifié : ${fichier}`);
      continue;
    }
    if (!fichier || ligne.startsWith('---') || ligne.startsWith('+++')) continue;
    const test = FICHIER_TEST.test(fichier);
    if (ligne.startsWith('-') && test && TEST_RETIRE.test(ligne)) ajouter(`test supprimé dans ${fichier}`);
    if (ligne.startsWith('+') && DESACTIVE.test(ligne)) ajouter(`test désactivé dans ${fichier}`);
    if (ligne.startsWith('+') && ISOLE.test(ligne)) ajouter(`test isolé dans ${fichier}`);
    if (ligne.startsWith('+') && CONTOURNEMENT.test(ligne)) ajouter(`contournement d’outil d’analyse dans ${fichier}`);
    if (ligne.startsWith('+') && EXCLUSION_COUVERTURE.test(ligne)) ajouter(`exclusion de couverture ajoutée dans ${fichier}`);
  }
  return signes;
}
