const INTERDITS_HORS_GUILLEMETS = ';&|<>()`$\\\n\r*?[]{}~!#';
const INTERDITS_ENTRE_DOUBLES = '$`\\';

/** Mots d'une commande « simple ». Toute syntaxe shell active (opérateur, redirection, expansion…) donne null. */
export function motsSimples(commande: string): string[] | null {
  const mots: string[] = [];
  let mot = '';
  let dansMot = false;
  for (let i = 0; i < commande.length; i++) {
    const c = commande[i];
    if (c === "'") {
      const fin = commande.indexOf("'", i + 1);
      if (fin < 0) return null;
      mot += commande.slice(i + 1, fin);
      dansMot = true;
      i = fin;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < commande.length && commande[j] !== '"'; j++) if (INTERDITS_ENTRE_DOUBLES.includes(commande[j])) return null;
      if (j >= commande.length) return null;
      mot += commande.slice(i + 1, j);
      dansMot = true;
      i = j;
    } else if (c === ' ' || c === '\t') {
      if (dansMot) mots.push(mot);
      mot = '';
      dansMot = false;
    } else if (INTERDITS_HORS_GUILLEMETS.includes(c)) {
      return null;
    } else {
      mot += c;
      dansMot = true;
    }
  }
  if (dansMot) mots.push(mot);
  return mots.length ? mots : null;
}

const LANCEURS = /^((ba|z|da|k)?sh|source|\.|node|python3?|perl|ruby|pwsh|deno|bun|tsx|ts-node)$/;

/** Fichiers exécutés par une commande, pour que le gardien lise leur contenu avant de laisser passer. */
export function fichiersExecutes(commande: string): string[] {
  const fichiers: string[] = [];
  for (const segment of commande.split(/&&|\|\||[;|\n]/)) {
    const mots = segment.trim().split(/\s+/).filter(Boolean);
    while (mots.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[0])) mots.shift();
    const [m0, m1] = mots;
    if (!m0) continue;
    if (LANCEURS.test(m0)) {
      if (m1 && !m1.startsWith('-')) fichiers.push(m1);
    } else if (m0.includes('/')) fichiers.push(m0);
  }
  return fichiers.map(f => f.replace(/^["']|["']$/g, ''));
}

const OPTIONS_GLOBALES_DANGEREUSES = /^(-c|--config-env|--exec-path|--git-dir|--work-tree|--namespace|--super-prefix)(=|$)/;

export function sousCommandeGit(mots: string[]): string | undefined {
  for (let i = 1; i < mots.length; i++) {
    const m = mots[i];
    if (OPTIONS_GLOBALES_DANGEREUSES.test(m)) return '-c';
    if (m === '-C') { i++; continue; }
    if (!m.startsWith('-')) return m;
  }
  return undefined;
}
