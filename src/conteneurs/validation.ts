import type Docker from 'dockerode';
import { brancheTache, executerJetable, RACINE_PROJET } from './docker.ts';

export type FichierModifie = { fichier: string; ajouts: number | null; suppressions: number | null };
export type LectureValidation = { pointe: string; commits: number; fichiers: FichierModifie[]; diff: string; tronque: boolean };
export const PLAFOND_DIFF = 2 * 1024 ** 2;
export const PLAFOND_BUNDLE = 48 * 1024 ** 2;

const SHA = /^[0-9a-f]{40}$/;
// Le dépôt du volume appartient à l'agent (config, attributs, refs/replace, grafts, shallow) : une seule commande l'interroge,
// la lecture de la pointe. Le commit-graph, le multi-pack-index et les bitmaps du volume (lus via alternates) sont désactivés : ils permettent de
// faire dire à git un autre arbre que celui du commit. Tout le reste tourne dans un dépôt nu vierge de /tmp qui emprunte seulement ses objets.
const ENV = 'export HOME=/tmp GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_NO_REPLACE_OBJECTS=1 GIT_ATTR_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0';
const GIT_VOLUME = `git -c safe.directory='*' --git-dir=${RACINE_PROJET}/.git`;
const PROPRE = `-c core.attributesFile=/dev/null -c attr.tree=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c diff.noprefix=false -c diff.mnemonicPrefix=false -c core.bigFileThreshold=512m -c core.quotePath=false -c core.commitGraph=false -c core.multiPackIndex=false -c pack.useBitmaps=false`;
const DIFF = `--no-ext-diff --no-textconv --no-color --text -M --src-prefix=a/ --dst-prefix=b/`;
// $1 base, $2 sha, $3 réf lue dans le volume (HEAD ou refs/heads/…), $4 nom de la réf dans le dépôt vierge : la pointe doit être sha, base doit exister.
const PREPARATION = [
  ENV,
  `tip=$(${GIT_VOLUME} rev-parse --verify "$3^{commit}") || exit 11`,
  `[ "$tip" = "$2" ] || exit 12`,
  `${GIT_VOLUME} cat-file -e "$1^{commit}" || exit 13`,
  `git init -q --bare /tmp/r || exit 14`,
  `echo ${RACINE_PROJET}/.git/objects > /tmp/r/objects/info/alternates`,
  `git -C /tmp/r update-ref "refs/heads/$4" "$2" || exit 15`,
].join('\n');
const lecture = (volume: string): Docker.MountConfig => [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }];

// Un seul conteneur jetable par lecture, sans réseau ; un délai dépassé ou une panne Docker donnent null (jamais d'exception).
async function lancer(docker: Docker, imageId: string, volume: string, script: string, args: string[]) {
  try {
    return await executerJetable(docker, imageId, ['sh', '-c', script, 'validation', ...args], lecture(volume));
  } catch {
    return null;
  }
}

export async function lireValidation(docker: Docker, imageId: string, volume: string, base: string, sha: string): Promise<LectureValidation | null> {
  if (!SHA.test(base) || !SHA.test(sha)) return null;
  // Sortie : pointe, nombre de commits, taille de numstat, numstat, puis diff (coupé à PLAFOND_DIFF + 1 octets).
  const script = `${PREPARATION}
cd /tmp/r
git ${PROPRE} rev-list --count "$1..refs/heads/$4" > /tmp/c || exit 21
git ${PROPRE} diff ${DIFF} --numstat -z "$1" "$2" > /tmp/n || exit 22
{ git ${PROPRE} diff ${DIFF} -U3 "$1" "$2"; echo $? > /tmp/s; } | head -c ${PLAFOND_DIFF + 1} > /tmp/d
s=$(cat /tmp/s); [ "$s" = 0 ] || [ "$s" = 141 ] || exit 23
printf '%s\n%s\n%s\n' "$tip" "$(cat /tmp/c)" "$(wc -c < /tmp/n)"
cat /tmp/n /tmp/d`;
  const r = await lancer(docker, imageId, volume, script, [base, sha, 'HEAD', 'validation']);
  if (!r || r.code !== 0) return null;
  const sortie = r.stdout;
  const entetes: string[] = [];
  let debut = 0;
  for (let n = 0; n < 3; n++) {
    const fin = sortie.indexOf(10, debut);
    if (fin < 0) return null;
    entetes.push(sortie.subarray(debut, fin).toString('utf8'));
    debut = fin + 1;
  }
  const [pointe, commits, tailleStat] = entetes;
  const taille = Number(tailleStat);
  if (pointe !== sha || !/^\d+$/.test(commits) || !Number.isInteger(taille) || debut + taille > sortie.length) return null;
  const brut = sortie.subarray(debut + taille);
  const tronque = brut.length > PLAFOND_DIFF;
  return {
    pointe,
    commits: Number(commits),
    fichiers: lireNumstat(sortie.subarray(debut, debut + taille).toString('utf8')),
    diff: tronque ? coupeSansCasser(brut.subarray(0, PLAFOND_DIFF)) : brut.toString('utf8'),
    tronque,
  };
}

// Une coupe au milieu d'un caractère UTF-8 : on retire la séquence incomplète finale plutôt que d'afficher U+FFFD.
function coupeSansCasser(octets: Buffer): string {
  let fin = octets.length;
  let reculs = 0;
  while (fin > 0 && reculs < 3 && (octets[fin - 1] & 0xc0) === 0x80) { fin--; reculs++; }
  if (fin > 0 && octets[fin - 1] >= 0xc0) {
    const attendu = octets[fin - 1] >= 0xf0 ? 4 : octets[fin - 1] >= 0xe0 ? 3 : 2;
    if (reculs + 1 < attendu) fin--; else fin = octets.length;
  } else fin = octets.length;
  return octets.subarray(0, fin).toString('utf8');
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
  // Pointe, dépôt vierge et bundle dans le même conteneur : aucune fenêtre entre la vérification et la fabrication.
  const script = `${PREPARATION}
git -C /tmp/r ${PROPRE} bundle create /tmp/b.bundle "$1..refs/heads/$4" 2>/dev/null || exit 16
[ "$(git -C /tmp/r bundle list-heads /tmp/b.bundle)" = "$2 refs/heads/$4" ] || exit 17
[ "$(stat -c %s /tmp/b.bundle)" -le ${PLAFOND_BUNDLE} ] || exit 18
base64 -w0 /tmp/b.bundle`;
  const r = await lancer(docker, imageId, volume, script, [base, sha, `refs/heads/${branche}`, branche]);
  if (!r || r.code !== 0) return null;
  const bundle = Buffer.from(r.stdout.toString('utf8'), 'base64');
  return bundle.length > 0 && bundle.length <= PLAFOND_BUNDLE ? bundle : null;
}
