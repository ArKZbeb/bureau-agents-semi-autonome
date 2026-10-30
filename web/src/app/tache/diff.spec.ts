import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { FichierModifie } from '../modeles';
import { DiffVue } from './diff';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts', 'index 111..222 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', ' gardé', '-vieux', '+neuf',
  'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1 +1 @@', '-b1', '+b2',
].join('\n');
const FICHIERS: FichierModifie[] = [{ fichier: 'src/a.ts', ajouts: 1, suppressions: 1 }, { fichier: 'src/b.ts', ajouts: 1, suppressions: 1 }];

async function ouvrir(donnees: { diff: string; fichiers: FichierModifie[]; tronque: boolean }) {
  const fx = TestBed.createComponent(DiffVue);
  fx.componentRef.setInput('donnees', donnees);
  await fx.whenStable();
  const el = fx.nativeElement as HTMLElement;
  return { fx, el, texte: () => el.textContent!.replace(/\s+/g, ' ') };
}
const ligne = (el: HTMLElement, t: string) => [...el.querySelectorAll('pre span')].find(s => s.textContent === t)!;

describe('DiffVue', () => {
  it('classe les lignes : ajout, retrait, entête', async () => {
    const { el } = await ouvrir({ diff: DIFF, fichiers: FICHIERS, tronque: false });
    expect(ligne(el, '+neuf').className).toBe('ajout');
    expect(ligne(el, '-vieux').className).toBe('retrait');
    expect(ligne(el, '+++ b/src/a.ts').className).toBe('entete');
    expect(ligne(el, '--- a/src/a.ts').className).toBe('entete');
    expect(ligne(el, '@@ -1,2 +1,2 @@').className).toBe('entete');
    expect(ligne(el, 'index 111..222 100644').className).toBe('entete');
    expect(ligne(el, 'diff --git a/src/a.ts b/src/a.ts').className).toBe('entete');
    expect(ligne(el, ' gardé').className).toBe('');
  });

  it('cliquer un fichier n’affiche que sa section', async () => {
    const { fx, el } = await ouvrir({ diff: DIFF, fichiers: FICHIERS, tronque: false });
    [...el.querySelectorAll('button')].find(b => b.textContent!.includes('src/b.ts'))!.click();
    await fx.whenStable();
    expect(ligne(el, '+b2')).toBeDefined();
    expect(el.querySelector('pre')!.textContent).not.toContain('+neuf');
  });

  it('U+202E : marqueur visible et bandeau', async () => {
    const { el, texte } = await ouvrir({ diff: '+a‮b', fichiers: [], tronque: false });
    expect(el.querySelector('pre')!.textContent).toContain('+a⟦U+202E⟧b');
    expect(texte()).toContain('Caractères invisibles ou de contrôle présents dans le diff');
  });

  it('pas de bandeau sans caractère suspect', async () => {
    const { texte } = await ouvrir({ diff: DIFF, fichiers: FICHIERS, tronque: false });
    expect(texte()).not.toContain('Caractères invisibles');
  });

  it('du HTML dans le diff reste du texte', async () => {
    const { el } = await ouvrir({ diff: '+<img src=x onerror=alert(1)>', fichiers: [{ fichier: '<img src=x>', ajouts: 1, suppressions: 0 }], tronque: false });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('pre')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('diff tronqué : bandeau', async () => {
    const { texte } = await ouvrir({ diff: DIFF, fichiers: FICHIERS, tronque: true });
    expect(texte()).toContain('Diff tronqué : récupère la branche pour tout voir');
  });

  it('fichier binaire : « binaire », sinon +a −s', async () => {
    const { texte } = await ouvrir({ diff: '', fichiers: [{ fichier: 'logo.png', ajouts: null, suppressions: null }, FICHIERS[0]], tronque: false });
    expect(texte()).toContain('logo.png binaire');
    expect(texte()).toContain('src/a.ts +1−1');
  });
});
