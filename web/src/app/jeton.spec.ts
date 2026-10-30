import { describe, expect, it } from 'vitest';
import { lireJeton, rangerJetonDuFragment } from './jeton';

const stockage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe('lireJeton', () => {
  it('prend le jeton du fragment et le range', () => {
    const s = stockage();
    expect(lireJeton('#jeton=abc_DEF-123', s)).toBe('abc_DEF-123');
    expect(s.m.get('jeton')).toBe('abc_DEF-123');
  });
  it('sans fragment, relit le jeton rangé', () => {
    const s = stockage();
    s.setItem('jeton', 'range');
    expect(lireJeton('', s)).toBe('range');
  });
  it('refuse un jeton de forme inattendue', () => {
    expect(lireJeton('#jeton=<script>', stockage())).toBeNull();
  });
});

describe('rangerJetonDuFragment', () => {
  const histoire = () => { const appels: unknown[][] = []; return { replaceState: (...a: unknown[]) => void appels.push(a), appels }; };

  it('range le jeton du fragment puis efface le fragment de l’URL, chemin et requête conservés', () => {
    const s = stockage(), h = histoire();
    rangerJetonDuFragment({ hash: '#jeton=abc_DEF-123', pathname: '/taches/T-1', search: '?x=1' }, s, h);
    expect(s.m.get('jeton')).toBe('abc_DEF-123');
    expect(h.appels).toEqual([[null, '', '/taches/T-1?x=1']]);
  });

  it('jeton de forme inattendue : rien n’est rangé, le fragment est effacé quand même', () => {
    const s = stockage(), h = histoire();
    rangerJetonDuFragment({ hash: '#jeton=<script>', pathname: '/', search: '' }, s, h);
    expect(s.m.size).toBe(0);
    expect(h.appels).toEqual([[null, '', '/']]);
  });

  it('sans jeton dans le fragment : URL et stockage intacts', () => {
    const s = stockage(), h = histoire();
    rangerJetonDuFragment({ hash: '#ailleurs', pathname: '/journal', search: '' }, s, h);
    rangerJetonDuFragment({ hash: '', pathname: '/', search: '' }, s, h);
    expect(s.m.size).toBe(0);
    expect(h.appels).toEqual([]);
  });
});
