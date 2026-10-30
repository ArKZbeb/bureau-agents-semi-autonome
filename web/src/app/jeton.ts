const FORME = /^[A-Za-z0-9_-]{1,128}$/;

// Le jeton arrive dans le fragment (#jeton=…), jamais envoyé au serveur ; il est gardé pour l'onglet seulement.
export function lireJeton(hash: string, stockage: Pick<Storage, 'getItem' | 'setItem'>): string | null {
  const m = /^#jeton=(.+)$/.exec(hash);
  if (m) {
    if (!FORME.test(m[1])) return null;
    stockage.setItem('jeton', m[1]);
    return m[1];
  }
  const range = stockage.getItem('jeton');
  return range && FORME.test(range) ? range : null;
}
