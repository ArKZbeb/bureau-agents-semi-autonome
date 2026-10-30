import type Docker from 'dockerode';
import { brancheTache, executerJetable, RACINE_PROJET } from './docker.ts';

export type FichierModifie = { fichier: string; ajouts: number | null; suppressions: number | null };
export type LectureValidation = { pointe: string; commits: number; fichiers: FichierModifie[]; diff: string; tronque: boolean };
export const PLAFOND_DIFF = 2 * 1024 ** 2;
export const PLAFOND_BUNDLE = 48 * 1024 ** 2;

const SHA = /^[0-9a-f]{40}$/;
const PREAMBULE = `export HOME=/tmp && git config --global --add safe.directory '*' && cd ${RACINE_PROJET}`;
const lecture = (volume: string): Docker.MountConfig => [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }];

async function git(docker: Docker, imageId: string, volume: string, script: string, args: string[]) {
  return executerJetable(docker, imageId, ['sh', '-c', `${PREAMBULE} && ${script}`, 'validation', ...args], lecture(volume));
}

export async function lireValidation(docker: Docker, imageId: string, volume: string, base: string, sha: string): Promise<LectureValidation | null> {
  if (!SHA.test(base) || !SHA.test(sha)) return null;
  const pointe = await git(docker, imageId, volume, 'git rev-parse HEAD', []);
  const commits = await git(docker, imageId, volume, 'git rev-list --count "$1..$2"', [base, sha]);
  const stat = await git(docker, imageId, volume, 'git -c core.quotePath=false diff --no-ext-diff --no-textconv --no-color -M --numstat -z "$1" "$2"', [base, sha]);
  const diff = await git(docker, imageId, volume, `git -c core.quotePath=false diff --no-ext-diff --no-textconv --no-color -M -U3 "$1" "$2" | head -c ${PLAFOND_DIFF + 1}`, [base, sha]);
  if ([pointe, commits, stat, diff].some(r => r.code !== 0)) return null;
  const p = pointe.stdout.toString('utf8').trim();
  if (!SHA.test(p)) return null;
  return {
    pointe: p,
    commits: Number(commits.stdout.toString('utf8').trim()),
    fichiers: lireNumstat(stat.stdout.toString('utf8')),
    diff: diff.stdout.subarray(0, PLAFOND_DIFF).toString('utf8'),
    tronque: diff.stdout.length > PLAFOND_DIFF,
  };
}

// --numstat -z : « ajouts\tsuppressions\tchemin\0 », ou pour un renommage « a\ts\t\0ancien\0nouveau\0 » ; « - » = binaire.
function lireNumstat(brut: string): FichierModifie[] {
  const morceaux = brut.split('\0');
  const fichiers: FichierModifie[] = [];
  for (let i = 0; i < morceaux.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(morceaux[i]);
    if (!m) continue;
    const nombre = (s: string) => (s === '-' ? null : Number(s));
    let fichier = m[3];
    if (fichier === '') { fichier = `${morceaux[i + 1]} → ${morceaux[i + 2]}`; i += 2; }
    fichiers.push({ fichier, ajouts: nombre(m[1]), suppressions: nombre(m[2]) });
  }
  return fichiers;
}

export async function lireBundle(docker: Docker, imageId: string, volume: string, tacheId: string, base: string, sha: string): Promise<Buffer | null> {
  if (!SHA.test(base) || !SHA.test(sha) || base === sha) return null;
  const branche = brancheTache(tacheId);
  // La pointe est relue dans le même conteneur que le bundle : aucune fenêtre entre la vérification et la fabrication.
  const script = `[ "$(git rev-parse "refs/heads/$3")" = "$2" ] || exit 4; git bundle create /tmp/b.bundle "$1..refs/heads/$3" 2>/dev/null || exit 5; `
    + `[ "$(stat -c %s /tmp/b.bundle)" -le ${PLAFOND_BUNDLE} ] || exit 6; base64 -w0 /tmp/b.bundle`;
  const r = await git(docker, imageId, volume, script, [base, sha, branche]);
  if (r.code !== 0) return null;
  const bundle = Buffer.from(r.stdout.toString('utf8'), 'base64');
  return bundle.length > 0 && bundle.length <= PLAFOND_BUNDLE ? bundle : null;
}
