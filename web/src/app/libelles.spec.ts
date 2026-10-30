import { describe, expect, it } from 'vitest';
import { budget, essai, eur, qui } from './libelles';
import type { Tache } from './modeles';

const t = (x: Partial<Tache>): Tache => ({ id: 'T-41', projet: 'Film', titre: 'Export PDF', cheminProjet: '/p', etape: 'implementation', statut: 'en_cours', raison: null, echangesPlan: 0, essaisQa: 0, budgetUsd: 6, depenseUsd: 2.35, agent: 'implementeur', ...x });

describe('libellés du kanban', () => {
  it('format monétaire de la maquette', () => expect(eur(5.9)).toBe('5,90 $'));
  it('budget consommé / plafond', () => expect(budget(t({}))).toBe('2,35 $ / 6,00 $'));
  it('essai seulement après le patron (plan)', () => {
    expect(essai(t({ etape: 'cadrage' }))).toBe('');
    expect(essai(t({ etape: 'implementation', essaisQa: 1 }))).toBe('essai 2/3');
  });
  it('qui travaille, ou qui attend', () => {
    expect(qui(t({}))).toBe('Implémenteur');
    expect(qui(t({ etape: 'cadrage', statut: 'attente_humain', agent: 'cadreur', raison: 'le cadreur attend ta réponse' }))).toBe('Cadreur · t’attend');
    expect(qui(t({ etape: 'validation', statut: 'attente_humain' }))).toBe('Toi · à valider');
    expect(qui(t({ statut: 'en_pause', raison: 'budget : plafond atteint' }))).toBe('Implémenteur · budget dépassé');
    expect(qui(t({ statut: 'en_pause', raison: 'escalade : npm install x' }))).toBe('Implémenteur · en pause');
    expect(qui(t({ statut: 'bloquee', raison: '3 no-go' }))).toBe('Bloquée · 3 no-go');
    expect(qui(t({ statut: 'prete', agent: null }))).toBe('En file');
  });
});
