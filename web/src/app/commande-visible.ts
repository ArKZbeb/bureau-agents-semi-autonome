// Caractères qui peuvent masquer, réordonner ou déguiser une partie d'une commande à l'écran :
// contrôles (Cc : C0, DEL, C1) ; formats (Cf : bidi, largeur nulle, U+00AD, U+180E, U+2061–206F, U+FEFF, U+FFF9–FFFB…) ;
// séparateurs de ligne et de paragraphe (Zl, Zp : rendus comme un saut de ligne) ; espaces non ASCII (Zs : Bash ne coupe pas
// les mots dessus) ; sélecteurs de variante ; étiquettes U+E0000–E007F ; fillers Hangul ; U+034F ; U+1D173–1D17A.
// \t, \n et l'espace U+0020 restent tels quels.
const INVISIBLES = new RegExp(String.raw`[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{E0000}-\u{E007F}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{034F}\u{1D173}-\u{1D17A}]`, 'gu');
const CONSERVES = new Set(['\t', '\n', ' ']);

/** Rend une commande fidèlement : chaque caractère invisible ou de contrôle devient `⟦U+XXXX⟧` (un marqueur par point de code). */
export function commandeVisible(commande: string): { texte: string; suspecte: boolean } {
  let suspecte = false;
  const texte = commande.replace(INVISIBLES, c => {
    if (CONSERVES.has(c)) return c;
    suspecte = true;
    return `⟦U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟧`;
  });
  return { texte, suspecte };
}
