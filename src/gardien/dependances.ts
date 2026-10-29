import path from 'node:path';

export type Ecosysteme = 'npm' | 'NuGet';
export type Dependance = { ecosysteme: Ecosysteme; nom: string; version: string | null };
export type Fiche = {
  ecosysteme: Ecosysteme; nom: string; version: string | null; existe: boolean | null; telechargements: number | null;
  periode: 'semaine' | 'total' | null; publieLe: string | null; licence: string | null; vulnerabilites: number | null; erreur: string | null;
};

const INSTALL_NPM = new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall']);

function specNpm(spec: string): Dependance {
  const at = spec.lastIndexOf('@');
  return at > 0
    ? { ecosysteme: 'npm', nom: spec.slice(0, at), version: spec.slice(at + 1) || null }
    : { ecosysteme: 'npm', nom: spec, version: null };
}

export function dependancesCommande(commande: string): Dependance[] {
  const res: Dependance[] = [];
  for (const segment of commande.split(/&&|\|\||[;|\n]/)) {
    const mots = segment.trim().split(/\s+/).filter(Boolean).map(m => m.replace(/^["']|["']$/g, ''));
    const [m0, m1] = mots;
    if ((m0 === 'npm' && INSTALL_NPM.has(m1)) || (m0 === 'ng' && m1 === 'add'))
      res.push(...mots.slice(2).filter(a => !a.startsWith('-')).map(specNpm));
    else if (m0 === 'dotnet' && m1 === 'add') {
      const p = mots.indexOf('package');
      const v = mots.indexOf('--version');
      if (p > 0 && mots[p + 1]) res.push({ ecosysteme: 'NuGet', nom: mots[p + 1], version: v > 0 ? mots[v + 1] ?? null : null });
    }
  }
  return res;
}

const CHAMPS_NPM = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function depsNpm(json: string | null): Map<string, string> | null {
  try {
    const p = JSON.parse(json ?? '{}') as Record<string, Record<string, string> | undefined>;
    return new Map(CHAMPS_NPM.flatMap(c => Object.entries(p[c] ?? {})));
  } catch {
    return null;
  }
}

function depsNuget(xml: string | null): Map<string, string | null> {
  const res = new Map<string, string | null>();
  for (const [balise] of (xml ?? '').matchAll(/<Package(?:Reference|Version)\b[^>]*>/gi)) {
    const nom = /\bInclude\s*=\s*"([^"]+)"/i.exec(balise)?.[1];
    if (nom) res.set(nom.toLowerCase(), /\bVersion\s*=\s*"([^"]*)"/i.exec(balise)?.[1] ?? null);
  }
  return res;
}

export function dependancesFichier(chemin: string, avant: string | null, apres: string): Dependance[] | null {
  const nom = path.posix.basename(chemin);
  if (nom === 'package.json') {
    const a = depsNpm(avant) ?? new Map();
    const b = depsNpm(apres);
    if (!b) return null;
    return [...b].filter(([n]) => !a.has(n)).map(([n, v]) => ({ ecosysteme: 'npm', nom: n, version: v }));
  }
  if (/\.(cs|fs|vb)proj$|\.props$/i.test(nom)) {
    const a = depsNuget(avant);
    const noms = new Map([...apres.matchAll(/\bInclude\s*=\s*"([^"]+)"/gi)].map(m => [m[1].toLowerCase(), m[1]]));
    return [...depsNuget(apres)].filter(([n]) => !a.has(n)).map(([n, v]) => ({ ecosysteme: 'NuGet', nom: noms.get(n) ?? n, version: v }));
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

export async function ficheDependance(d: Dependance, f: typeof fetch = fetch): Promise<Fiche> {
  const base: Fiche = { ...d, existe: null, telechargements: null, periode: null, publieLe: null, licence: null, vulnerabilites: null, erreur: null };
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
    const version: string = d.version ?? p.version;
    const vulns = await osv(f, d, version);
    return { ...base, version, existe: true, telechargements: p.totalDownloads ?? null, periode: 'total', licence: p.licenseUrl ?? null, vulnerabilites: vulns?.vulns?.length ?? 0 };
  } catch (e) {
    return { ...base, erreur: (e as Error).message };
  }
}
