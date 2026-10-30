import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { App } from './app';
import { ApiService, JETON } from './api';
import { EtatBureau } from './etat';

describe('App', () => {
  const api = { arretGlobal: vi.fn(), repriseGlobale: vi.fn() };
  const etat = {
    escalades: signal([]), etat: signal({ ordonnanceur: 'actif' }), erreur: signal<string | null>(null),
    demarrer: vi.fn(), arreter: vi.fn(), rafraichir: vi.fn(),
  };

  const creer = (jeton: string) => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: JETON, useValue: jeton }, { provide: ApiService, useValue: api }, { provide: EtatBureau, useValue: etat }],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const bouton = (el: HTMLElement, texte: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(texte)) as HTMLButtonElement;

  beforeEach(() => {
    vi.clearAllMocks();
    etat.etat.set({ ordonnanceur: 'actif' });
    api.arretGlobal.mockResolvedValue({});
    etat.rafraichir.mockResolvedValue(undefined);
  });

  it('sans jeton, explique quoi faire et ne lance pas l’interrogation', () => {
    const el = creer('');
    expect(el.querySelector('h1')?.textContent).toContain('Jeton de session manquant');
    expect(etat.demarrer).not.toHaveBeenCalled();
  });

  it('arrêt global : annuler n’appelle rien, confirmer appelle une fois', async () => {
    const el = creer('jeton');
    expect(etat.demarrer).toHaveBeenCalledTimes(1);
    bouton(el, 'Arrêt global').click();
    TestBed.tick();
    bouton(el, 'Annuler').click();
    TestBed.tick();
    expect(api.arretGlobal).not.toHaveBeenCalled();
    bouton(el, 'Arrêt global').click();
    TestBed.tick();
    bouton(el, 'Tout arrêter').click();
    await Promise.resolve();
    expect(api.arretGlobal).toHaveBeenCalledTimes(1);
  });
});
