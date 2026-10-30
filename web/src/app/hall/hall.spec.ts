import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { EtatBureau } from '../etat';
import type { Projet, Tache } from '../modeles';
import { Hall } from './hall';

const tache = (o: Partial<Tache>): Tache => ({
  id: 'T-41', projet: 'Film', titre: 'Ajouter la recherche', cheminProjet: '/depots/film', etape: 'implementation', statut: 'en_cours',
  raison: null, echangesPlan: 0, essaisQa: 0, budgetUsd: 6, depenseUsd: 1.2, agent: 'implementeur', ...o,
});
const projet = (nom: string): Projet => ({ nom, chemin: `/depots/${nom}`, budgetUsd: 6, couvertureLignes: 80, relieLe: '2026-10-30' });

describe('Hall', () => {
  const etat = { taches: signal<Tache[]>([]), projets: signal<Projet[]>([]), rafraichir: async () => undefined };
  beforeEach(() => {
    etat.taches.set([]); etat.projets.set([]);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: EtatBureau, useValue: etat }] });
  });
  const rendre = async () => {
    const f = TestBed.createComponent(Hall);
    await f.whenStable();
    return f.nativeElement as HTMLElement;
  };

  it('affiche les 7 colonnes dans l’ordre avec leur nombre de tâches, sans tâches terminées ni abandonnées', async () => {
    etat.projets.set([projet('Film')]);
    etat.taches.set([
      tache({ id: 'T-1' }), tache({ id: 'T-2' }),
      tache({ id: 'T-3', statut: 'terminee', etape: 'validation' }), tache({ id: 'T-4', statut: 'abandonnee', etape: 'qa' }),
    ]);
    const el = await rendre();
    const titres = [...el.querySelectorAll('.colonne h3')].map(h => h.textContent!.replace(/\s+/g, ' ').trim());
    expect(titres).toEqual(['Cadrage 0', 'Patron (plan) 0', 'Implémentation 2', 'Review 0', 'Patron (code) 0', 'QA 0', 'Validation 0']);
    expect(el.querySelectorAll('.carte').length).toBe(2);
  });

  it('une carte affiche projet, id, titre, qui, essai et budget, et mène à /taches/T-41', async () => {
    etat.projets.set([projet('Film')]);
    etat.taches.set([tache({})]);
    const el = await rendre();
    const carte = el.querySelector('a.carte')!;
    const texte = carte.textContent!.replace(/\s+/g, ' ');
    expect(texte).toContain('Film T-41');
    expect(texte).toContain('Ajouter la recherche');
    expect(texte).toContain('Implémenteur');
    expect(texte).toContain('essai 1/3');
    expect(texte).toContain('1,20 $ / 6,00 $');
    expect(carte.getAttribute('href')).toBe('/taches/T-41');
  });

  it('la liste des projets affiche le nombre de tâches, toutes étapes', async () => {
    etat.projets.set([projet('Film')]);
    etat.taches.set([tache({ id: 'T-1' }), tache({ id: 'T-2', statut: 'terminee', etape: 'validation' })]);
    const el = await rendre();
    expect(el.querySelector('.projet')!.textContent!.trim()).toBe('Film · 2');
    expect(el.textContent).toContain('+ Nouvelle user story');
  });

  it('sans projet : bureau vide, relier un premier projet, pas de nouvelle user story', async () => {
    const el = await rendre();
    expect(el.textContent).toContain('Le bureau est vide');
    expect(el.textContent).toContain('+ Relier un premier projet');
    expect(el.textContent).not.toContain('+ Nouvelle user story');
  });

  it('sans projet relié mais avec des tâches : le tableau reste affiché, pas de nouvelle user story', async () => {
    etat.taches.set([tache({ id: 'T-7', titre: 'Tâche d’avant les projets' })]);
    const el = await rendre();
    expect(el.textContent).not.toContain('Le bureau est vide');
    expect(el.querySelectorAll('.colonne').length).toBe(7);
    expect(el.textContent).toContain('Tâche d’avant les projets');
    expect(el.textContent).toContain('+ Relier un projet');
    expect(el.textContent).not.toContain('+ Nouvelle user story');
  });

  it('rend les titres de tâche comme texte, jamais comme HTML', async () => {
    etat.projets.set([projet('Film')]);
    etat.taches.set([tache({ titre: '<img src=x onerror=alert(1)>' })]);
    const el = await rendre();
    expect(el.querySelector('a.carte img')).toBeNull();
    expect(el.querySelector('a.carte')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
