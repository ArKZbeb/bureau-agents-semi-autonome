import path from 'node:path';
import { motsSimples, sousCommandeGit } from './commande.ts';

export type VerdictDecide = {
  suite: 'decide'; decision: 'Autorisé' | 'Refusé' | 'Escaladé'; decideur: 'Liste blanche' | 'Liste noire' | 'Gardien'; raison: string;
};
export type Verdict2 = VerdictDecide | { suite: 'couche3'; raison: string };

const refus = (raison: string): VerdictDecide => ({ suite: 'decide', decision: 'Refusé', decideur: 'Liste noire', raison });
const autorise = (raison: string): VerdictDecide => ({ suite: 'decide', decision: 'Autorisé', decideur: 'Liste blanche', raison });
const escalade = (raison: string): VerdictDecide => ({ suite: 'decide', decision: 'Escaladé', decideur: 'Gardien', raison });

const ENV = 'lecture des variables d’environnement';
const TELECHARGEMENT = 'téléchargement suivi d’exécution';

// Évaluée AVANT la liste blanche, sur la commande brute (ou ses mots, message de commit exclu).
export const LISTE_NOIRE: [RegExp, string][] = [
  [/\b(sudo|doas)\b|(^|[\s;&|(])su(\s|$)/, 'élévation de privilèges'],
  [/\bchmod\b[^;&|]*(\b0?777\b|\+s\b|[oa]\+\w*w)/, 'permissions dangereuses (chmod)'],
  [/\bchown\b/, 'changement de propriétaire'],
  [/\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?((ba|z|da|k|fi)?sh|python3?|node|perl|ruby|php)\b/, TELECHARGEMENT],
  [/(<\(|\$\(|`)\s*(curl|wget)\b/, TELECHARGEMENT],
  [/\|\s*(sudo\s+)?(ba|z|da|k|fi)?sh(\s|$|;|&|\))/, 'flux exécuté par un shell (commande déguisée)'],
  [/\b(eval|alias)\b/, 'commande déguisée (eval / alias)'],
  [/\$'[^']*\\(x[0-9a-fA-F]|[0-7]{3}|u[0-9a-fA-F])/, 'commande obfusquée (séquences d’échappement)'],
  [/\bprintenv\b|\/proc\/\S*\/environ|\bexport\s+-p\b|\bdeclare\s+-[a-zA-Z]*x|(^|[\s;&|(])(env|set)\s*($|[|;&>)])/, ENV],
  [/\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|JETON|ANTHROPIC|CREDENTIAL)/i, ENV],
  [/\bos\.environ\b|\bprocess\.env\b|\bgetenv\b|GetEnvironmentVariable/, ENV],
  [/(^|[\s'"=/<])\.env(\.[\w.-]+)?($|[\s'";|&>)])|\bid_(rsa|ed25519|ecdsa|dsa)\b|\.ssh\/|\.aws\/|\.azure\/|\.docker\/config\.json|\.git-credentials|\.netrc\b|\.(pem|pfx|p12|key)($|[\s'";|&>)])|\bsecrets\.json\b/i, 'accès à des fichiers de secrets'],
  [/docker\.sock|\b(docker|podman|kubectl|nerdctl)\b/, 'accès au socket Docker'],
  [/\/etc\/claude-code|managed-settings|\/opt\/hooks|\.etat-claude|CLAUDE_CONFIG_DIR|hook-gardien/, 'modification de la configuration Claude Code ou des hooks'],
  [/\.git\/(hooks|config)\b/, 'modification des internes Git'],
  [/\b(nc|ncat|netcat|socat|telnet|ssh|scp|sftp|rsync|ftp)\b|\/dev\/(tcp|udp)\//, 'outil réseau direct'],
  [/(>>?|\btee\s+(-a\s+)?)\s*(~|\/(?!workspace\/projet\/|tmp\/|dev\/null\b))/, 'écriture hors du projet'],
];

const GIT_INTERDIT: Record<string, string> = {
  '-c': 'option Git globale interdite (-c, --git-dir…)',
  push: 'git push interdit : seul l’orchestrateur récupère la branche',
  config: 'git config interdit',
};
const GIT_RESEAU = new Set(['remote', 'credential', 'credential-store', 'credential-cache', 'submodule', 'fetch', 'pull', 'clone', 'ls-remote', 'daemon', 'send-email', 'request-pull']);

const dans = (racine: string, abs: string) => abs === racine || abs.startsWith(`${racine}/`);

// Le message d'un commit est une donnée : il n'est pas soumis à la liste noire.
function texteAControler(mots: string[]): string {
  if (mots[0] !== 'git') return mots.join(' ');
  return mots.filter((_, i) => mots[i - 1] !== '-m' && mots[i - 1] !== '--message').join(' ');
}

function reglesStructurelles(mots: string[], racine: string): VerdictDecide | null {
  if (mots[0] === 'git') {
    const sc = sousCommandeGit(mots);
    if (sc && GIT_INTERDIT[sc]) return refus(GIT_INTERDIT[sc]);
    if (sc && GIT_RESEAU.has(sc)) return refus('opération Git hors du dépôt local');
  }
  if (mots[0] === 'rm') {
    const cibles = mots.slice(1).filter(a => !a.startsWith('-')).map(a => path.posix.resolve(racine, a));
    if (!cibles.length || cibles.some(c => !c.startsWith(`${racine}/`) || dans(`${racine}/.git`, c))) return refus('suppression hors du projet');
  }
  return null;
}

const OPTIONS_DOTNET = new Set(['--no-build', '--no-restore', '--nologo', '--locked-mode', '-c', '--configuration', '--filter', '-v', '--verbosity']);
const OPTIONS_NG_TEST = /^--(code-coverage|watch=false|no-watch|browsers=[\w,]+|include=[\w./*-]+|project=[\w-]+)$/;
const OPTIONS_NPM_CI = new Set(['--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']);
const LECTURE = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'pwd', 'tree', 'diff', 'echo', 'stat', 'file']);
const FIND_INTERDIT = /^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/;

function listeBlanche(mots: string[], racine: string): string | null {
  const [m0, m1] = mots;
  const args = (debut: number, optionPermise: (o: string) => boolean) =>
    mots.slice(debut).every(a => (a.startsWith('-') ? optionPermise(a) : dans(racine, path.posix.resolve(racine, a))));

  if (m0 === 'dotnet' && (m1 === 'build' || m1 === 'test') && args(2, o => OPTIONS_DOTNET.has(o) || o.startsWith('--collect:')))
    return m1 === 'test' ? 'tests' : 'commande de build';
  if (m0 === 'dotnet' && m1 === 'restore' && mots.includes('--locked-mode') && args(2, o => OPTIONS_DOTNET.has(o))) return 'restauration verrouillée';
  const ng = m0 === 'ng' ? 1 : m0 === 'npx' && m1 === 'ng' ? 2 : 0;
  if (ng && mots[ng] === 'test' && args(ng + 1, o => OPTIONS_NG_TEST.test(o))) return 'tests front';
  if (m0 === 'npm' && m1 === 'ci' && args(2, o => OPTIONS_NPM_CI.has(o))) return 'installation verrouillée';
  if (m0 === 'git' && sousCommandeGit(mots) === m1) {
    if (['status', 'diff', 'log', 'show'].includes(m1) && args(2, o => !/^--(output|ext-diff|textconv)/.test(o))) return 'lecture Git';
    if (m1 === 'add' && args(2, o => ['-A', '--all', '-u', '--update'].includes(o))) return 'ajout au commit';
    if (m1 === 'commit') {
      for (let i = 2; i < mots.length; i++) {
        if (mots[i] === '-m' || mots[i] === '--message') i++;
        else if (!['-a', '--all', '--amend', '--no-edit'].includes(mots[i])) return null;
      }
      return 'commit sur la branche de la tâche';
    }
  }
  if (LECTURE.has(m0) && args(1, o => !(m0 === 'find' && FIND_INTERDIT.test(o)))) return 'lecture du projet';
  return null;
}

export function evaluerBash(commande: string, racine: string): Verdict2 {
  const mots = motsSimples(commande);
  const texte = mots ? texteAControler(mots) : commande;
  for (const [motif, raison] of LISTE_NOIRE) if (motif.test(texte)) return refus(raison);
  if (mots) {
    const structurelle = reglesStructurelles(mots, racine);
    if (structurelle) return structurelle;
    const raison = listeBlanche(mots, racine);
    if (raison) return autorise(raison);
    return { suite: 'couche3', raison: 'commande hors liste blanche' };
  }
  if (/\bgit\b[^;&|]*\s(push|config|credential\S*|remote|fetch|pull|clone)\b|\bgit\s+(\S+\s+)*-c\s/.test(commande)) return refus('opération Git interdite');
  if (/\brm\b[^;&|]*\s(\/|~|\.\.|\$)/.test(commande)) return refus('suppression hors du projet');
  return { suite: 'couche3', raison: 'commande composée' };
}

const SECRETS_FICHIER = /(^|\/)\.env(\.[\w.-]+)?$|(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$|(^|\/)\.(ssh|aws|azure)\/|\.git-credentials$|(^|\/)\.netrc$|\.(pem|pfx|p12|key)$|(^|\/)secrets\.json$/i;
const CONFIG_AGENT = /^\/etc\/claude-code(\/|$)|^\/opt\/hooks(\/|$)|^\/workspace\/\.etat-claude(\/|$)/;

// Modifier ces chemins sans que le plan le prévoie = me demander.
export const PROTEGES: RegExp[] = [
  /^\.github\//, /(^|\/)\.gitlab-ci\.yml$/, /(^|\/)azure-pipelines[^/]*\.ya?ml$/, /(^|\/)Jenkinsfile$/,
  /(^|\/)(Dockerfile|Containerfile)[^/]*$/i, /(^|\/)docker-compose[^/]*\.ya?ml$/, /(^|\/)\.devcontainer\//,
  /(^|\/)\.claude\//, /(^|\/)CLAUDE\.md$/, /(^|\/)\.mcp\.json$/, /(^|\/)(nuget\.config|\.npmrc|\.yarnrc(\.yml)?)$/i,
  /(^|[/._-])(Auth|Authentication|Authorization|Jwt|OAuth|Oidc|Identity|Security)(?![a-z])/,
  /(^|[/._-])(auth|authentication|authorization|jwt|oauth|oidc|identity|security)([/._-]|$)/,
];

export function evaluerFichier(chemin: string, mode: 'lecture' | 'ecriture', racine: string, zonesPrevues: string[]): VerdictDecide {
  const abs = path.posix.resolve(racine, chemin);
  if (SECRETS_FICHIER.test(abs)) return refus('accès à des fichiers de secrets');
  if (CONFIG_AGENT.test(abs)) return refus('modification de la configuration Claude Code ou des hooks');
  const projet = dans(racine, abs);
  if (!projet && !abs.startsWith('/tmp/')) return refus(mode === 'lecture' ? 'lecture hors du projet' : 'écriture hors du projet');
  if (mode === 'lecture') return autorise('lecture du projet');
  if (!projet) return autorise('écriture temporaire');
  const rel = abs.slice(racine.length + 1);
  if (rel === '.git' || rel.startsWith('.git/')) return refus('modification des internes Git');
  if (PROTEGES.some(p => p.test(rel)) && !zonesPrevues.some(z => correspondGlob(z, rel))) return escalade(`modification non prévue au plan : ${rel}`);
  return autorise('écriture dans le projet');
}

// Fichiers dont le contenu est exécuté par le build ou les tests.
const FICHIERS_EXECUTES = /\.(sh|bash|zsh|ps1|psm1|cmd|bat|csproj|fsproj|vbproj|props|targets|mjs|cjs)$|(^|\/)(package\.json|karma\.conf\.(js|cjs|mjs|ts)|angular\.json|Makefile)$/i;

export function evaluerContenu(chemin: string, contenu: string, toujours = false): VerdictDecide | null {
  if (!toujours && !FICHIERS_EXECUTES.test(chemin)) return null;
  for (const [motif, raison] of LISTE_NOIRE) if (motif.test(contenu)) return refus(`contenu dangereux dans ${path.posix.basename(chemin)} : ${raison}`);
  return null;
}

const echapper = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function correspondGlob(glob: string, rel: string): boolean {
  const re = glob.split('**/').map(a => a.split('**').map(b => b.split('*').map(echapper).join('[^/]*')).join('.*')).join('(?:.*/)?');
  return new RegExp(`^${re}$`).test(rel);
}

export function zonesDuPlan(plan: string | null): string[] {
  const section = plan?.split(/^## /m).find(s => /^Zones touchées/i.test(s));
  return section ? [...section.matchAll(/^\s*[-*]\s+`([^`]+)`/gm)].map(m => m[1]) : [];
}
