// Contrôles C0 (sauf \t et \n), DEL, C1, contrôles bidirectionnels et caractères de largeur nulle :
// ils peuvent masquer ou réordonner une partie d'une commande à l'écran.
const INVISIBLES = new RegExp('[' + [
  '\\x00-\\x08', '\\x0B-\\x1F', '\\x7F-\\x9F', // C0 sauf \t et \n, DEL, C1
  '\\u061C', '\\u200E', '\\u200F', '\\u202A-\\u202E', '\\u2066-\\u2069', // bidirectionnels
  '\\u200B-\\u200D', '\\u2060', '\\uFEFF', // largeur nulle
].join('') + ']', 'g');

/** Rend une commande fidèlement : chaque caractère invisible ou de contrôle devient `⟦U+XXXX⟧`. */
export function commandeVisible(commande: string): { texte: string; suspecte: boolean } {
  let suspecte = false;
  const texte = commande.replace(INVISIBLES, c => {
    suspecte = true;
    return `⟦U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟧`;
  });
  return { texte, suspecte };
}
