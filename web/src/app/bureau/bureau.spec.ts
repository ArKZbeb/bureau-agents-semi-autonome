import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { EtatBureau } from '../etat';
import type { Tache } from '../modeles';
import { Bureau } from './bureau';

const t = (id: string, o: Partial<Tache>): Tache => ({
  id, projet: 'Film', titre: `Titre ${id}`, cheminProjet: '/d', etape: 'validation', statut: 'attente_humain', raison: null, echangesPlan: 0, essaisQa: 0, budgetUsd: 6, depenseUsd: 1.2, agent: null, ...o,
});

function ouvrir(taches: Tache[]) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: EtatBureau, useValue: { taches: signal(taches) } }] });
  const fx = TestBed.createComponent(Bureau);
  fx.detectChanges();
  const el = fx.nativeElement as HTMLElement;
  return { el, texte: () => el.textContent!.replace(/\s+/g, ' ') };
}

describe('Bureau', () => {
  it('liste les tâches à valider puis les bloquées, avec liens', () => {
    const { el, texte } = ouvrir([
      t('T-1', { statut: 'bloquee', etape: 'qa', raison: 'trois échecs' }), t('T-2', {}), t('T-3', { statut: 'en_cours', etape: 'review' }),
    ]);
    expect(texte()).toContain('Mon bureau · Boîte de validation');
    const liens = [...el.querySelectorAll('a')];
    expect(liens.map(a => a.getAttribute('href'))).toEqual(['/taches/T-2', '/taches/T-1']);
    expect(liens[0].textContent).toContain('T-2 · Film');
    expect(liens[0].textContent).toContain('Titre T-2');
    expect(liens[0].textContent).toContain('1,20 $ / 6,00 $');
    expect(texte()).not.toContain('Rien à valider');
  });

  it('état vide', () => {
    const { texte } = ouvrir([t('T-3', { statut: 'en_cours', etape: 'review' })]);
    expect(texte()).toContain("Rien à valider pour l'instant.");
  });
});
