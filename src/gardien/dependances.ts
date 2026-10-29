import path from 'node:path';

export type Ecosysteme = 'npm' | 'NuGet';
export type Dependance = { ecosysteme: Ecosysteme; nom: string; version: string | null };
export type Fiche = {
  ecosysteme: Ecosysteme; nom: string; version: string | null; existe: boolean | null; telechargements: number | null;
  periode: 'semaine' | 'total' | null; publieLe: string | null; licence: string | null; vulnerabilites: number | null; erreur: string | null;
};

const SOUS_COMMANDES_NPM = new Set(['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add', 'exec', 'update', 'up', 'upgrade']);
const VALEURS_NPM = new Set(['--prefix', '--registry', '--workspace', '-w', '--tag']);
const ENVELOPPES = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'nice', 'xargs']);
const VALEURS_DOTNET = new Set(['--version', '-v', '--add-source', '--configfile']);

function specNpm(spec: string): Dependance {
  const at = spec.lastIndexOf('@');
  return at > 0
    ? { ecosysteme: 'npm', nom: spec.slice(0, at), version: spec.slice(at + 1) || null }
    : { ecosysteme: 'npm', nom: spec, version: null };
}

// Paquets d'une liste d'arguments npm, pnpm ou yarn : on saute les options et leurs valeurs.
function paquetsNpm(mots: string[], debut: number): Dependance[] {
  const res: Dependance[] = [];
  for (let i = debut; i < mots.length; i++) {
    if (VALEURS_NPM.has(mots[i])) i++;
    else if (!mots[i].startsWith('-')) res.push(specNpm(mots[i]));
  }
  return res;
}

// Premier argument hors options (et hors valeurs d'options dotnet).
function premierArg(mots: string[], debut: number): string | undefined {
  for (let i = debut; i < mots.length; i++) {
    if (VALEURS_DOTNET.has(mots[i])) i++;
    else if (!mots[i].startsWith('-')) return mots[i];
  }
  return undefined;
}

// Retire VAR=x, sudo/env/time/…, bash -c et timeout <durée> qui précèdent la vraie commande.
function sansEnveloppes(mots: string[]): string[] {
  let i = 0;
  let enveloppe = false;
  while (i < mots.length) {
    const m = mots[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(m) || ENVELOPPES.has(m)) { enveloppe = true; i++; }
    else if (enveloppe && m.startsWith('-')) i++;
    else if (/^(ba|z|da|k)?sh$/.test(m) && /^-\w*c\w*$/.test(mots[i + 1] ?? '')) { enveloppe = true; i += 2; }
    else if (m === 'timeout') { enveloppe = true; i++; if (/^[\d.]+[smhd]?$/.test(mots[i] ?? '')) i++; }
    else break;
  }
  return mots.slice(i);
}

export function dependancesCommande(commande: string): Dependance[] {
  const res: Dependance[] = [];
  // ponytail: découpe naïve ; les guillemets sont retirés, pas interprétés. Le gardien évalue aussi la commande brute.
  for (const segment of commande.replace(/['"]/g, '').split(/&&|\|\||[;|&\n()`]|\$\(/)) {
    const mots = sansEnveloppes(segment.trim().split(/\s+/).filter(Boolean));
    const [m0, m1, m2] = mots;
    if (m0 === 'npm' || m0 === 'pnpm' || m0 === 'yarn') {
      if (SOUS_COMMANDES_NPM.has(m1)) res.push(...paquetsNpm(mots, 2));
    } else if (m0 === 'ng' && m1 === 'add') {
      res.push(...paquetsNpm(mots, 2));
    } else if (m0 === 'npx') {
      const p = mots.slice(1).find(m => !m.startsWith('-'));
      if (p) res.push(specNpm(p));
    } else if (m0 === 'dotnet') {
      const v = mots.findIndex(m => m === '--version' || m === '-v');
      const version = v > 0 ? mots[v + 1] ?? null : null;
      const p = mots.indexOf('package');
      if (m1 === 'add' && p > 0 && mots[p + 1]) res.push({ ecosysteme: 'NuGet', nom: mots[p + 1], version });
      else if ((m1 === 'tool' && m2 === 'install') || (m1 === 'new' && m2 === 'install')) {
        const nom = premierArg(mots, 3);
        if (nom) res.push({ ecosysteme: 'NuGet', nom, version });
      }
    }
  }
  return res;
}

const CHAMPS_NPM = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions'];
type EntreeNpm = { nom: string; spec: string };

// Clé = section/nom : une même dépendance déplacée de section compte comme nouvelle.
function depsNpm(json: string | null): Map<string, EntreeNpm> | null {
  try {
    const p = JSON.parse(json ?? '{}') as Record<string, Record<string, unknown> | undefined>;
    return new Map(CHAMPS_NPM.flatMap(c => Object.entries(p[c] ?? {}).map(([nom, v]) =>
      [`${c}/${nom}`, { nom, spec: typeof v === 'string' ? v : JSON.stringify(v) }] as const)));
  } catch {
    return null;
  }
}

type EntreeNuget = { nom: string; version: string | null };

function depsNuget(xml: string | null): Map<string, EntreeNuget> {
  const res = new Map<string, EntreeNuget>();
  for (const [balise] of (xml ?? '').matchAll(/<Package(?:Reference|Version)\b[^>]*>/gi)) {
    const nom = /\bInclude\s*=\s*(["'])(.*?)\1/i.exec(balise)?.[2];
    if (nom) res.set(nom.toLowerCase(), { nom, version: /\bVersion\s*=\s*(["'])(.*?)\1/i.exec(balise)?.[2] ?? null });
  }
  return res;
}

export function dependancesFichier(chemin: string, avant: string | null, apres: string): Dependance[] | null {
  const nom = path.posix.basename(chemin);
  if (nom === 'package.json') {
    const a: Map<string, EntreeNpm> = depsNpm(avant) ?? new Map();
    const b = depsNpm(apres);
    if (!b) return null;
    return [...b].filter(([k, e]) => a.get(k)?.spec !== e.spec).map(([, e]) => ({ ecosysteme: 'npm', nom: e.nom, version: e.spec }));
  }
  if (/\.(cs|fs|vb)proj$|\.props$/i.test(nom)) {
    const a = depsNuget(avant);
    return [...depsNuget(apres)].filter(([n, e]) => a.get(n)?.version !== e.version).map(([, e]) => ({ ecosysteme: 'NuGet', nom: e.nom, version: e.version }));
  }
  return [];
}

type Json = any;

async function json(f: typeof fetch, url: string, init?: RequestInit): Promise<Json | null> {
  const r = await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r.json();
}

const osv = (f: typeof fetch, d: Dependance, version: string | null) =>
  json(f, 'https://api.osv.dev/v1/query', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { name: d.nom, ecosystem: d.ecosysteme }, ...(version ? { version } : {}) }),
  });

// Sources non registre (git, URL, chemin, alias npm…) : jamais une fiche rassurante.
const SOURCE_HORS_REGISTRE = /^(npm:|git|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:|\/|\.|~\/)/;

function horsRegistre(d: Dependance): boolean {
  if (d.version && SOURCE_HORS_REGISTRE.test(d.version)) return true;
  if (d.nom.includes(':')) return true;
  return d.nom.includes('/') && !/^@[^/]+\/[^/]+$/.test(d.nom);
}

export async function ficheDependance(d: Dependance, f: typeof fetch = fetch): Promise<Fiche> {
  const base: Fiche = { ...d, existe: null, telechargements: null, periode: null, publieLe: null, licence: null, vulnerabilites: null, erreur: null };
  if (horsRegistre(d)) return { ...base, existe: false, erreur: 'source hors registre' };
  try {
    if (d.ecosysteme === 'npm') {
      const meta = await json(f, `https://registry.npmjs.org/${d.nom.replace('/', '%2f')}`);
      if (!meta) return { ...base, existe: false };
      const version: string | null = d.version && meta.versions?.[d.version] ? d.version : meta['dist-tags']?.latest ?? null;
      const dl = await json(f, `https://api.npmjs.org/downloads/point/last-week/${d.nom}`);
      const vulns = await osv(f, d, version);
      return {
        ...base, version, existe: true, telechargements: dl?.downloads ?? null, periode: 'semaine',
        publieLe: (version && meta.time?.[version]) ?? meta.time?.created ?? null,
        licence: (version && meta.versions?.[version]?.license) ?? meta.license ?? null, vulnerabilites: vulns?.vulns?.length ?? 0,
      };
    }
    const q = await json(f, `https://azuresearch-usnc.nuget.org/query?q=packageid:${encodeURIComponent(d.nom)}&prerelease=false&semVerLevel=2.0.0`);
    const p = (q?.data ?? []).find((x: Json) => String(x.id).toLowerCase() === d.nom.toLowerCase());
    if (!p) return { ...base, existe: false };
    // Plage de versions (ex. [1.0,2.0)) : pas de version exacte à interroger, OSV sans version.
    const plage = d.version !== null && /[*[\](),]/.test(d.version);
    const version: string | null = plage ? null : (d.version ?? p.version);
    const vulns = await osv(f, d, version);
    return { ...base, version, existe: true, telechargements: p.totalDownloads ?? null, periode: 'total', licence: p.licenseUrl ?? null, vulnerabilites: vulns?.vulns?.length ?? 0 };
  } catch (e) {
    return { ...base, erreur: (e as Error).message };
  }
}
