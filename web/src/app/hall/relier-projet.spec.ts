import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';
import type { Detection } from '../modeles';
import { RelierProjet } from './relier-projet';

const complete: Detection = {
  chemin: '/depots/planning', nomPropose: 'planning', git: true,
  dotnet: { solution: 'Planning.sln', projets: 3, projetsTests: 1 }, angular: { fichier: 'planning-web/angular.json' },
};

describe('RelierProjet', () => {
  const api = { detecter: vi.fn(), relier: vi.fn() };
  const etat = { rafraichir: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    etat.rafraichir.mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, { provide: EtatBureau, useValue: etat }] });
  });

  async function ouvrir() {
    const f = TestBed.createComponent(RelierProjet);
    const fermer = vi.fn();
    f.componentInstance.fermer.subscribe(fermer);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const attendre = async () => { await f.whenStable(); };
    const saisir = async (sel: string, v: string) => {
      const i = el.querySelector<HTMLInputElement>(sel)!;
      i.value = v; i.dispatchEvent(new Event('input'));
      await attendre();
    };
    const bouton = (texte: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === texte)!;
    const detecter = async (chemin: string) => {
      await saisir('input[aria-label="Dossier local"]', chemin);
      bouton('Détecter').click();
      await attendre(); await attendre();
    };
    return { el, fermer, saisir, bouton, detecter, attendre };
  }

  it('détecte et affiche stacks, nom, seuil et budget par défaut', async () => {
    api.detecter.mockResolvedValue(complete);
    const { el, detecter, attendre } = await ouvrir();
    await detecter('/depots/planning');
    await attendre();
    expect(api.detecter).toHaveBeenCalledWith('/depots/planning');
    const t = el.textContent!.replace(/\s+/g, ' ');
    expect(t).toContain('✓ .NET'); expect(t).toContain('Planning.sln · 3 projets (1 de tests)');
    expect(t).toContain('✓ Angular'); expect(t).toContain('planning-web/angular.json');
    const champs = [...el.querySelectorAll('input')].map(i => i.value);
    expect(champs).toContain('planning'); expect(champs).toContain('80'); expect(champs).toContain('6');
  });

  it('refuse un dossier qui n’est pas un dépôt Git', async () => {
    api.detecter.mockResolvedValue({ ...complete, git: false });
    const { el, detecter, bouton } = await ouvrir();
    await detecter('/depots/planning');
    expect(el.textContent).toContain('✕ Pas un dépôt Git');
    expect(bouton('Relier le projet').disabled).toBe(true);
  });

  it('refuse un dossier sans stack .NET ou Angular', async () => {
    api.detecter.mockResolvedValue({ ...complete, dotnet: null, angular: null });
    const { el, detecter, bouton } = await ouvrir();
    await detecter('/depots/planning');
    expect(el.textContent).toContain('✕ Aucune stack .NET ou Angular');
    expect(bouton('Relier le projet').disabled).toBe(true);
  });

  it('relie le projet, rafraîchit l’état et ferme', async () => {
    api.detecter.mockResolvedValue(complete);
    api.relier.mockResolvedValue({});
    const { detecter, bouton, fermer, attendre } = await ouvrir();
    await detecter('/depots/planning');
    await attendre();
    bouton('Relier le projet').click();
    await attendre(); await attendre();
    expect(api.relier).toHaveBeenCalledWith({ nom: 'planning', chemin: '/depots/planning', budgetUsd: 6, couvertureLignes: 80 });
    expect(etat.rafraichir).toHaveBeenCalled();
    expect(fermer).toHaveBeenCalledTimes(1);
  });

  it('affiche l’erreur de l’API et reste ouvert', async () => {
    api.detecter.mockResolvedValue(complete);
    api.relier.mockRejectedValue(new Error('projet déjà relié : planning'));
    const { el, detecter, bouton, fermer, attendre } = await ouvrir();
    await detecter('/depots/planning');
    await attendre();
    bouton('Relier le projet').click();
    await attendre(); await attendre();
    expect(el.querySelector('.alerte')!.textContent).toContain('projet déjà relié : planning');
    expect(fermer).not.toHaveBeenCalled();
  });

  it('seuil ou budget vide ou hors bornes : « Relier le projet » désactivé, rien n’est envoyé', async () => {
    api.detecter.mockResolvedValue(complete);
    const { detecter, bouton, saisir, attendre } = await ouvrir();
    await detecter('/depots/planning');
    await attendre();
    const seuil = 'input[aria-label="Seuil de couverture"]', budget = 'input[aria-label="Budget par tâche"]';
    expect(bouton('Relier le projet').disabled).toBe(false);
    for (const [champ, valeur, sain] of [
      [seuil, '', '80'], [seuil, '101', '80'], [seuil, '-1', '80'], [seuil, '50.5', '80'],
      [budget, '', '6'], [budget, '0', '6'], [budget, '-2', '6'],
    ]) {
      await saisir(champ, valeur);
      expect(bouton('Relier le projet').disabled, `${champ} = « ${valeur} »`).toBe(true);
      bouton('Relier le projet').click();
      await saisir(champ, sain);
    }
    expect(api.relier).not.toHaveBeenCalled();
    await saisir(seuil, '0');
    expect(bouton('Relier le projet').disabled).toBe(false);
  });
});
