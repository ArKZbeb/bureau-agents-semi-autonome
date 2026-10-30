import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import type { EntreeHistorique, Tache } from '../modeles';
import { BlocageVue } from './blocage';

const tache: Tache = {
  id: 'T-41', projet: 'Film', titre: 'Ajouter la recherche', cheminProjet: '/d', etape: 'qa', statut: 'bloquee', raison: 'trois no-go consécutifs',
  echangesPlan: 0, essaisQa: 3, budgetUsd: 6, depenseUsd: 4.5, agent: null,
};
const historique: EntreeHistorique[] = [
  { creeLe: '2026-10-30T11:00:00', verdict: 'no_go', regles: ['R-dernière'], criteresNonRemplis: [{ numero: 2, preuve: 'test absent' }] },
  { creeLe: '2026-10-30T10:00:00', verdict: 'no_go', regles: ['R-milieu'], criteresNonRemplis: [{ numero: 1, preuve: 'ancienne preuve' }] },
  { creeLe: '2026-10-30T09:00:00', verdict: 'go', regles: [], criteresNonRemplis: [] },
];

describe('BlocageVue', () => {
  const api = { historique: vi.fn(), action: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    api.historique.mockResolvedValue(historique);
    api.action.mockResolvedValue({});
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  async function ouvrir(h: EntreeHistorique[] = historique) {
    api.historique.mockResolvedValue(h);
    const fx = TestBed.createComponent(BlocageVue);
    fx.componentRef.setInput('tache', tache);
    const faits: string[] = [];
    fx.componentInstance.fait.subscribe(m => faits.push(m));
    const attendre = async () => { await fx.whenStable(); await fx.whenStable(); };
    await attendre();
    const el = fx.nativeElement as HTMLElement;
    const bouton = (t: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === t) as HTMLButtonElement;
    return { fx, el, attendre, bouton, faits, texte: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  it('en-tête et résumé : raison, règles et critères de la dernière entrée seulement', async () => {
    const { texte } = await ouvrir();
    expect(texte()).toContain('Mon bureau · Tâche bloquée');
    expect(texte()).toContain('T-41 · Film');
    expect(texte()).toContain('3 no-go · 4,50 $ / 6,00 $');
    expect(texte()).toContain('Résumé du blocage');
    expect(texte()).toContain('trois no-go consécutifs');
    expect(texte()).toContain('C2 · Preuve : test absent');
    expect(texte()).not.toContain('ancienne preuve');
    expect(texte()).toContain("Rien n'a touché le repo Film.");
    expect(api.historique).toHaveBeenCalledTimes(1);
  });

  it('historique dans l’ordre reçu', async () => {
    const { texte } = await ouvrir();
    expect(texte()).toContain('Historique des 3 essais');
    const t = texte();
    expect(t.indexOf('R-dernière')).toBeLessThan(t.indexOf('R-milieu'));
    expect(t).toContain('NO-GO');
    expect(t).toContain('GO');
  });

  it('Relancer et Reprendre le cadrage', async () => {
    const { bouton, attendre, faits } = await ouvrir();
    bouton('Relancer').click(); await attendre();
    expect(api.action).toHaveBeenLastCalledWith('T-41', 'reprise', {});
    bouton('Reprendre le cadrage').click(); await attendre();
    expect(api.action).toHaveBeenLastCalledWith('T-41', 'relance', { vers: 'cadrage' });
    expect(faits.length).toBe(2);
    expect(api.historique).toHaveBeenCalledTimes(3);
  });

  it('relance avec commentaire : « Relancer » du dialogue désactivé si vide', async () => {
    const { el, bouton, attendre, fx } = await ouvrir();
    bouton('Relancer avec commentaire').click(); await attendre();
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    const valider = () => [...el.querySelectorAll('footer button')].find(b => b.textContent!.trim() === 'Relancer') as HTMLButtonElement;
    expect(valider().disabled).toBe(true);
    ta.value = '  '; ta.dispatchEvent(new Event('input')); await attendre();
    expect(valider().disabled).toBe(true);
    ta.value = 'Regarde le C2'; ta.dispatchEvent(new Event('input')); await attendre();
    expect(valider().disabled).toBe(false);
    valider().click(); await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'relance', { vers: 'implementation', commentaire: 'Regarde le C2' });
    expect(el.querySelector('textarea')).toBeNull();
    fx.destroy();
  });

  it('abandon : confirmation puis action', async () => {
    const { el, bouton, attendre } = await ouvrir();
    bouton('Abandonner').click(); await attendre();
    expect(api.action).not.toHaveBeenCalled();
    expect(el.textContent).toContain("La branche n'est pas récupérée et l'espace de la tâche est supprimé.");
    [...el.querySelectorAll('footer button')].find(b => b.textContent!.trim() === 'Annuler')!.dispatchEvent(new Event('click')); await attendre();
    expect(el.querySelector('.dialogue')).toBeNull();
    bouton('Abandonner').click(); await attendre();
    (el.querySelector('footer .danger') as HTMLButtonElement).click(); await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'abandon', {});
  });

  it('boutons désactivés pendant l’appel, erreur 409 affichée', async () => {
    let rejeter!: (e: Error) => void;
    api.action.mockReturnValueOnce(new Promise((_, r) => { rejeter = r; }));
    const { el, bouton, attendre } = await ouvrir();
    bouton('Relancer').click(); await attendre();
    expect([...el.querySelectorAll('.actions button')].every(b => (b as HTMLButtonElement).disabled)).toBe(true);
    rejeter(new Error('un agent travaille encore')); await attendre();
    expect(el.textContent).toContain('un agent travaille encore');
    expect(bouton('Relancer').disabled).toBe(false);
  });

  it('texte hostile des verdicts rendu en texte', async () => {
    const { el } = await ouvrir([{ creeLe: '2026-10-30T11:00:00', verdict: 'no_go', regles: ['<script>alert(1)</script>'], criteresNonRemplis: [{ numero: 1, preuve: '<img src=x onerror=alert(1)>' }] }]);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });
});
