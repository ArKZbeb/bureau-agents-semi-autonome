import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import type { Tache } from '../modeles';
import { AlerteVue } from './alerte';

const tache: Tache = {
  id: 'T-41', projet: 'Film', titre: 'Ajouter la recherche', cheminProjet: '/d', etape: 'implementation', statut: 'en_pause', raison: 'integrite : plan altéré <b>x</b>',
  echangesPlan: 0, essaisQa: 0, budgetUsd: 6, depenseUsd: 1, agent: null,
};

describe('AlerteVue', () => {
  const api = { action: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    api.action.mockResolvedValue({});
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  async function ouvrir() {
    const fx = TestBed.createComponent(AlerteVue);
    fx.componentRef.setInput('tache', tache);
    const faits: string[] = [];
    fx.componentInstance.fait.subscribe(m => faits.push(m));
    const attendre = async () => { await fx.whenStable(); await fx.whenStable(); };
    await attendre();
    const el = fx.nativeElement as HTMLElement;
    const bouton = (t: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === t) as HTMLButtonElement;
    return { el, attendre, bouton, faits, texte: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  it('en-tête et raison sans préfixe, en texte', async () => {
    const { el, texte } = await ouvrir();
    expect(texte()).toContain("Poste de sécurité · Alerte d'intégrité");
    expect(texte()).toContain('T-41 · Film');
    expect(texte()).toContain('Étape Implémentation · tâche en pause');
    expect(texte()).toContain('plan altéré <b>x</b>');
    expect(texte()).not.toContain('integrite :');
    expect(el.querySelector('b')).toBeNull();
    expect(texte()).toContain('Quelle que soit ta décision, elle est consignée dans le journal des commandes.');
  });

  it('Reprendre et Compter comme no-go et relancer', async () => {
    const { bouton, attendre, faits } = await ouvrir();
    bouton('Reprendre').click(); await attendre();
    expect(api.action).toHaveBeenLastCalledWith('T-41', 'reprise', {});
    bouton('Compter comme no-go et relancer').click(); await attendre();
    expect(api.action).toHaveBeenLastCalledWith('T-41', 'relance', { vers: 'implementation' });
    expect(faits.length).toBe(2);
  });

  it('abandon : confirmation puis action', async () => {
    const { el, bouton, attendre } = await ouvrir();
    bouton('Abandonner la tâche').click(); await attendre();
    expect(api.action).not.toHaveBeenCalled();
    expect(el.textContent).toContain("La branche n'est pas récupérée et l'espace de la tâche est supprimé.");
    (el.querySelector('footer .danger') as HTMLButtonElement).click(); await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'abandon', {});
  });

  it('erreur 409 affichée', async () => {
    api.action.mockRejectedValueOnce(new Error('relance refusée'));
    const { el, bouton, attendre } = await ouvrir();
    bouton('Reprendre').click(); await attendre();
    expect(el.textContent).toContain('relance refusée');
    expect(bouton('Reprendre').disabled).toBe(false);
  });
});
