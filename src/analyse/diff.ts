// Lignes ajoutées ou modifiées dans la nouvelle version, d'après un `git diff --text --no-ext-diff --no-textconv -U0`.

// Chemin d'un en-tête `+++ ` : tabulation finale (chemin à espaces), ou forme entre guillemets avec octets en octal.
function cheminCible(brut: string): string | null {
  let cible = brut.replace(/\t.*$/, '').trim();
  if (cible === '/dev/null') return null;
  if (cible.startsWith('"') && cible.endsWith('"')) {
    const octets: number[] = [];
    const interieur = cible.slice(1, -1);
    for (let i = 0; i < interieur.length; i++) {
      const c = interieur[i];
      if (c === '\\') {
        const octal = /^[0-7]{3}/.exec(interieur.slice(i + 1));
        const simple: Record<string, number> = { n: 10, t: 9, '"': 34, '\\': 92 };
        if (octal) { octets.push(parseInt(octal[0], 8)); i += 3; } else { octets.push(simple[interieur[i + 1]] ?? interieur.charCodeAt(i + 1)); i += 1; }
      } else {
        octets.push(...Buffer.from(c));
      }
    }
    cible = Buffer.from(octets).toString('utf8');
  }
  return cible.replace(/^b\//, '');
}

export function lignesModifiees(patch: string): Map<string, Set<number>> {
  const resultat = new Map<string, Set<number>>();
  let courant: Set<number> | null = null;
  let restantAncien = 0;
  let restantNouveau = 0;
  for (const ligne of patch.split('\n')) {
    // Dans un hunk, on consomme exactement le nombre de lignes annoncé : une ligne ajoutée
    // qui ressemble à `+++ ` ou `@@ ` n'est pas un en-tête.
    if (restantAncien > 0 || restantNouveau > 0) {
      if (ligne.startsWith('-')) restantAncien--;
      else if (ligne.startsWith('+')) restantNouveau--;
      else if (!ligne.startsWith('\\')) { restantAncien--; restantNouveau--; }
      continue;
    }
    if (ligne.startsWith('+++ ')) {
      const chemin = cheminCible(ligne.slice(4));
      if (chemin === null) courant = null;
      else {
        courant = resultat.get(chemin) ?? new Set();
        resultat.set(chemin, courant);
      }
      continue;
    }
    const entete = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(ligne);
    if (entete) {
      restantAncien = entete[1] === undefined ? 1 : Number(entete[1]);
      const debut = Number(entete[2]);
      const nombre = entete[3] === undefined ? 1 : Number(entete[3]);
      restantNouveau = nombre;
      if (courant) for (let i = 0; i < nombre; i++) courant.add(debut + i);
    }
  }
  for (const [chemin, lignes] of resultat) if (lignes.size === 0) resultat.delete(chemin);
  return resultat;
}
