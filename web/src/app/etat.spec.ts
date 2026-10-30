import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api';
import { EtatBureau } from './etat';

describe('EtatBureau', () => {
  const api = { taches: vi.fn(), escalades: vi.fn(), projets: vi.fn(), etat: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    api.taches.mockResolvedValue([{ id: 'T-41' }]);
    api.escalades.mockResolvedValue([{ id: 1 }]);
    api.projets.mockResolvedValue([{ nom: 'Film' }]);
    api.etat.mockResolvedValue({ ordonnanceur: 'actif' });
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('rafraîchit tout et interroge toutes les 3 s', async () => {
    const e = TestBed.inject(EtatBureau);
    e.demarrer();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.taches()).toEqual([{ id: 'T-41' }]);
    expect(e.escalades()).toEqual([{ id: 1 }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.taches).toHaveBeenCalledTimes(2);
    e.arreter();
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.taches).toHaveBeenCalledTimes(2);
  });

  it('garde le dernier état connu et affiche l’erreur si l’API ne répond plus', async () => {
    const e = TestBed.inject(EtatBureau);
    await e.rafraichir();
    api.taches.mockRejectedValueOnce(new Error('jeton de session requis'));
    await e.rafraichir();
    expect(e.taches()).toEqual([{ id: 'T-41' }]);
    expect(e.erreur()).toBe('jeton de session requis');
  });

  it('demarrer est idempotent : un seul intervalle', async () => {
    const e = TestBed.inject(EtatBureau);
    e.demarrer(); e.demarrer();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.taches).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.taches).toHaveBeenCalledTimes(2);
    e.arreter();
  });

  it('saute une interrogation tant que la précédente tourne', async () => {
    let fin!: (v: unknown[]) => void;
    api.taches.mockReturnValueOnce(new Promise((r) => (fin = r)));
    const e = TestBed.inject(EtatBureau);
    const premier = e.rafraichir();
    await e.rafraichir();
    expect(api.taches).toHaveBeenCalledTimes(1);
    fin([{ id: 'T-1' }]);
    await premier;
    expect(e.taches()).toEqual([{ id: 'T-1' }]);
  });
});
