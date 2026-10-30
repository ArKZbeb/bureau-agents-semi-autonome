import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';
import { NouvelleStory } from './nouvelle-story';

describe('NouvelleStory', () => {
  const api = { creerTache: vi.fn() };
  const etat = { projets: signal([{ nom: 'Film' }, { nom: 'Planning' }]), rafraichir: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    etat.rafraichir.mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, { provide: EtatBureau, useValue: etat }] });
  });

  async function ouvrir() {
    const f = TestBed.createComponent(NouvelleStory);
    const fermer = vi.fn();
    f.componentInstance.fermer.subscribe(fermer);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const attendre = async () => { await f.whenStable(); };
    const saisir = async (sel: string, v: string) => {
      const i = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!;
      i.value = v; i.dispatchEvent(new Event('input'));
      await attendre();
    };
    const envoyer = () => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Envoyer au cadreur')!;
    return { el, fermer, saisir, envoyer, attendre };
  }

  it('liste les projets reliés', async () => {
    const { el } = await ouvrir();
    expect([...el.querySelectorAll('option')].map(o => o.textContent!.trim())).toEqual(['Film', 'Planning']);
  });

  it('désactive l’envoi tant que titre ou description est vide', async () => {
    const { envoyer, saisir } = await ouvrir();
    expect(envoyer().disabled).toBe(true);
    await saisir('input:not([type])', 'Recherche');
    expect(envoyer().disabled).toBe(true);
    await saisir('textarea', 'Ajouter une recherche');
    expect(envoyer().disabled).toBe(false);
  });

  it('crée la tâche, rafraîchit et ferme', async () => {
    api.creerTache.mockResolvedValue({});
    const { envoyer, saisir, fermer, attendre } = await ouvrir();
    await saisir('input:not([type])', 'Recherche');
    await saisir('textarea', 'Ajouter une recherche');
    envoyer().click();
    await attendre(); await attendre();
    expect(api.creerTache).toHaveBeenCalledWith({ projet: 'Film', titre: 'Recherche', demande: 'Ajouter une recherche' });
    expect(etat.rafraichir).toHaveBeenCalled();
    expect(fermer).toHaveBeenCalledTimes(1);
  });

  it('affiche l’erreur et reste ouvert', async () => {
    api.creerTache.mockRejectedValue(new Error('projet inconnu'));
    const { el, envoyer, saisir, fermer, attendre } = await ouvrir();
    await saisir('input:not([type])', 'Recherche');
    await saisir('textarea', 'Ajouter une recherche');
    envoyer().click();
    await attendre(); await attendre();
    expect(el.querySelector('.alerte')!.textContent).toContain('projet inconnu');
    expect(fermer).not.toHaveBeenCalled();
    expect(envoyer().disabled).toBe(false);
  });
});
