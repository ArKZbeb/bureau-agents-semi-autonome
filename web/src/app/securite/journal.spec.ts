import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import type { EntreeJournal } from '../modeles';
import { Journal } from './journal';

const entree = (id: number, o: Partial<EntreeJournal> = {}): EntreeJournal => ({
  id, tacheId: 'T-41', horodatage: '2026-10-30T09:05:00', type: 'pretooluse', outil: 'Bash', commande: `cmd ${id}`, couche: 'liste_blanche',
  decision: 'Autorisé', decideur: 'gardien', raison: 'liste blanche', ...o,
});

describe('Journal', () => {
  const api = { journal: vi.fn(), integrite: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.resetAllMocks();
    api.integrite.mockResolvedValue({ intacte: true, entrees: 3 });
    api.journal.mockResolvedValue([]);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });
  afterEach(() => { vi.useRealTimers(); });

  async function ouvrir(entrees: EntreeJournal[]) {
    api.journal.mockResolvedValue(entrees);
    const fx = TestBed.createComponent(Journal);
    await fx.whenStable(); await fx.whenStable();
    const el = fx.nativeElement as HTMLElement;
    const lignes = () => [...el.querySelectorAll('tbody tr')].map(tr => tr.textContent!.replace(/\s+/g, ' '));
    const choisir = async (label: string, valeur: string) => {
      const s = el.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
      s.value = valeur; s.dispatchEvent(new Event('change'));
      await fx.whenStable();
    };
    return { fx, el, lignes, choisir, texte: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  it('chaîne intacte', async () => {
    const { texte, el } = await ouvrir([]);
    expect(texte()).toContain('Poste de sécurité · Journal des commandes');
    expect(texte()).toContain('✓ Chaîne intacte sur 3 entrées');
    expect(el.querySelector('.go')).not.toBeNull();
  });

  it('chaîne rompue', async () => {
    api.integrite.mockResolvedValue({ intacte: false, entrees: 3, erreur: 'entrée 2 altérée' });
    const { texte, el } = await ouvrir([]);
    expect(texte()).toContain('✕ Chaîne rompue : entrée 2 altérée');
    expect(el.querySelector('.nogo')).not.toBeNull();
  });

  it('ordre décroissant par id, colonnes', async () => {
    const { lignes, el } = await ouvrir([entree(1), entree(3), entree(2)]);
    expect(lignes().map(l => l.match(/cmd \d/)![0])).toEqual(['cmd 3', 'cmd 2', 'cmd 1']);
    expect([...el.querySelectorAll('th')].map(th => th.textContent)).toEqual(['Heure', 'Tâche', 'Commande', 'Couche', 'Décision', 'Décideur', 'Raison']);
    expect(lignes()[0]).toContain('09:05');
  });

  it('filtres Tâche et Décision', async () => {
    const { lignes, choisir } = await ouvrir([
      entree(1), entree(2, { tacheId: 'T-42', decision: 'Refusé' }), entree(3, { tacheId: 'T-42', decision: 'Escaladé' }),
    ]);
    await choisir('Tâche', 'T-42');
    expect(lignes()).toHaveLength(2);
    await choisir('Décision', 'Refusé');
    expect(lignes()).toHaveLength(1);
    expect(lignes()[0]).toContain('cmd 2');
    await choisir('Tâche', '');
    await choisir('Décision', '');
    expect(lignes()).toHaveLength(3);
  });

  it('600 entrées : 500 lignes et mention', async () => {
    const { lignes, texte } = await ouvrir(Array.from({ length: 600 }, (_, i) => entree(i + 1)));
    expect(lignes()).toHaveLength(500);
    expect(texte()).toContain('500 plus récentes sur 600');
    expect(lignes()[0]).toContain('cmd 600');
  });

  it('commande rendue en texte, rechargement toutes les 3 s', async () => {
    const { el, fx } = await ouvrir([entree(1, { commande: '<img src=x>' })]);
    expect(el.querySelector('img')).toBeNull();
    const n = api.journal.mock.calls.length;
    vi.advanceTimersByTime(3000);
    await fx.whenStable();
    expect(api.journal.mock.calls.length).toBe(n + 1);
    fx.destroy();
    vi.advanceTimersByTime(6000);
    expect(api.journal.mock.calls.length).toBe(n + 1);
  });
});
