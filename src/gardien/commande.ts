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

const ENVELOPPES = new Set(['env', 'nohup', 'exec', 'command', 'time', 'nice', 'timeout', 'xargs']);
// Options, durées, nombres et signaux qui suivent une enveloppe (heuristique : le gardien évalue aussi la commande brute).
const MOTS_ENVELOPPE = /^(-|[\d.]+[smhd]?$|[A-Z]+$)/;
const SHELL = /^(ba|z|da|k)?sh$/;
const MOT = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

// Option qui fait exécuter du code en ligne (pas un fichier) : sh -c, node -e, python3 -c, node --eval…
function enLigne(lanceur: string, option: string): boolean {
  return SHELL.test(lanceur) ? /^-\w*c\w*$/.test(option) : /^(-[cmep]|--eval|--print)$/.test(option);
}

function sansEnveloppes(mots: string[]): string[] {
  let i = 0;
  while (i < mots.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[i])) i++;
    else if (ENVELOPPES.has(mots[i])) {
      i++;
      while (i < mots.length && MOTS_ENVELOPPE.test(mots[i])) i++;
    } else break;
  }
  return mots.slice(i);
}

/** Fichiers exécutés par une commande, pour que le gardien lise leur contenu avant de laisser passer. */
export function fichiersExecutes(commande: string): string[] {
  const fichiers: string[] = [];
  const nettoyer = (f: string) => f.replace(/["']/g, '');
  for (const segment of commande.split(/&&|\|\||[;|\n&()]/)) {
    const REDIRECTION = /<\s*((?:[^\s"'<>]+|"[^"]*"|'[^']*')+)/g;
    for (const r of segment.matchAll(REDIRECTION)) fichiers.push(nettoyer(r[1]));
    const mots = sansEnveloppes((segment.replace(REDIRECTION, ' ').match(MOT) ?? []).map(nettoyer));
    const m0 = mots[0];
    if (!m0) continue;
    if (LANCEURS.test(m0)) {
      for (const o of mots.slice(1)) {
        if (enLigne(m0, o)) break;
        if (o.startsWith('-')) continue;
        fichiers.push(o);
        break;
      }
    } else if (m0.includes('/')) fichiers.push(m0);
  }
  return fichiers;
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
