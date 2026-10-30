import { describe, expect, it } from 'vitest';
import { lireJeton } from './jeton';

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
