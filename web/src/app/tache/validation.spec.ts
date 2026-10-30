import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import type { DossierValidation, FicheTache, TypeDocument } from '../modeles';
import { ValidationVue } from './validation';

const docs = (o: Partial<Record<TypeDocument, string | null>> = {}): Record<TypeDocument, string | null> => ({
  demande: null, spec: null, criteres: null, plan: null, avis_patron: null, resume: null, rapport: null, avis_patron_code: null, verdict: null, analyse: null, ...o,
});
const fiche: FicheTache = {
  tache: { id: 'T-41', projet: 'Film', titre: 'Ajouter la recherche', cheminProjet: '/d', etape: 'validation', statut: 'attente_humain', raison: null, echangesPlan: 0, essaisQa: 0, budgetUsd: 6, depenseUsd: 1, agent: null },
  documents: docs({ verdict: JSON.stringify({ qa: { verdict: 'go', criteres: [] }, regles: [], verdict: 'go' }), avis_patron_code: 'Attention au nommage' }),
};
const dossier = (o: Partial<DossierValidation> = {}): DossierValidation => ({
  branche: 'tache/T-41', sha: 'a'.repeat(40), commits: 3,
  fichiers: [{ fichier: 'a.ts', ajouts: 10, suppressions: 2 }, { fichier: 'b.png', ajouts: null, suppressions: null }, { fichier: 'c.ts', ajouts: 5, suppressions: 1 }],
  diff: '+x', tronque: false, integrite: { verifiee: true }, journal: { commandes: 12, refus: 2, escalades: 1 }, ...o,
});

describe('ValidationVue', () => {
  const api = { validation: vi.fn(), action: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    api.validation.mockResolvedValue(dossier());
    api.action.mockResolvedValue({});
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  async function ouvrir(d: DossierValidation = dossier()) {
    api.validation.mockResolvedValue(d);
    const fx = TestBed.createComponent(ValidationVue);
    fx.componentRef.setInput('id', 'T-41');
    fx.componentRef.setInput('fiche', fiche);
    fx.componentRef.setInput('journal', [{ id: 1, tacheId: 'T-41', horodatage: '2026-10-30T09:05:00', type: 'pretooluse', outil: 'Bash', commande: 'ls', couche: 'liste_blanche', decision: 'autorise', decideur: 'gardien', raison: 'ok' }]);
    await fx.whenStable(); await fx.whenStable();
    const el = fx.nativeElement as HTMLElement;
    const attendre = async () => { await fx.whenStable(); await fx.whenStable(); };
    const bouton = (t: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === t) as HTMLButtonElement;
    return { fx, el, attendre, bouton, texte: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  it('en-tête, totaux, intégrité et verdict QA', async () => {
    const { texte, el } = await ouvrir();
    expect(texte()).toContain('T-41 · Film');
    expect(texte()).toContain('Ajouter la recherche');
    expect(texte()).toContain('tache/T-41 · 3 commits · +15 −3');
    expect(texte()).toContain('✓ Intégrité vérifiée');
    expect(el.querySelector('.go')).not.toBeNull();
    expect(texte()).toContain('Verdict QA : GO');
    expect(api.validation).toHaveBeenCalledTimes(1);
  });

  it('intégrité non vérifiée : raison affichée, Récupérer et PR désactivés', async () => {
    const { texte, el, bouton } = await ouvrir(dossier({ integrite: { verifiee: false, raison: 'sha différent' } }));
    expect(texte()).toContain('✕ Intégrité non vérifiée : sha différent');
    expect(el.querySelector('.nogo')).not.toBeNull();
    expect(bouton('Ouvrir une PR').disabled).toBe(true);
    expect(bouton('Récupérer la branche').disabled).toBe(true);
  });

  it('onglets : avis du patron et journal', async () => {
    const { fx, bouton, texte, el } = await ouvrir();
    bouton('Avis du patron').click(); await fx.whenStable();
    expect(texte()).toContain("Note critique non bloquante · Patron · d'après le diff et les rapports");
    expect(el.querySelector('pre')!.textContent).toBe('Attention au nommage');
    bouton('Journal').click(); await fx.whenStable();
    expect(texte()).toContain('12 commandes · 2 refus · 1 escalade(s)');
    expect(texte()).toContain('ls · autorise');
  });

  it('Récupérer : une seule action malgré le double clic, puis message', async () => {
    const { bouton, attendre, texte } = await ouvrir();
    bouton('Récupérer la branche').click(); bouton('Récupérer la branche').click();
    await attendre();
    expect(api.action).toHaveBeenCalledTimes(1);
    expect(api.action).toHaveBeenCalledWith('T-41', 'recuperation', {});
    expect(texte()).toContain('Branche tache/T-41 récupérée dans ton dépôt.');
  });

  it('PR : l’URL est affichée en texte, sans lien', async () => {
    api.action.mockResolvedValue({ tache: {}, url: 'https://github.com/o/r/pull/7' });
    const { bouton, attendre, texte, el } = await ouvrir();
    bouton('Ouvrir une PR').click();
    await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'pr', {});
    expect(texte()).toContain('PR ouverte : https://github.com/o/r/pull/7');
    expect(el.querySelector('a')).toBeNull();
  });

  it('erreur 409 affichée telle quelle, boutons réactivés', async () => {
    api.action.mockRejectedValue(new Error('la tâche n’attend pas cette action'));
    const { bouton, attendre, texte } = await ouvrir();
    bouton('Récupérer la branche').click();
    await attendre();
    expect(texte()).toContain('la tâche n’attend pas cette action');
    expect(bouton('Récupérer la branche').disabled).toBe(false);
  });

  it('renvoi : désactivé si vide, puis appelle l’action avec le commentaire', async () => {
    const { fx, el, bouton, attendre, texte } = await ouvrir();
    bouton('Renvoyer avec commentaire').click(); await fx.whenStable();
    expect(bouton('Renvoyer').disabled).toBe(true);
    const zone = el.querySelector('textarea')!;
    zone.value = '  Ajoute un test  '; zone.dispatchEvent(new Event('input'));
    await fx.whenStable();
    expect(bouton('Renvoyer').disabled).toBe(false);
    bouton('Renvoyer').click();
    await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'renvoi', { commentaire: 'Ajoute un test' });
    expect(texte()).toContain("Tâche renvoyée à l'implémenteur.");
  });

  it('abandon : Annuler n’appelle rien, confirmer appelle abandon', async () => {
    const { fx, bouton, attendre, texte } = await ouvrir();
    bouton('Abandonner').click(); await fx.whenStable();
    expect(texte()).toContain("Abandonner T-41 ? La branche n'est pas récupérée et l'espace de la tâche est supprimé.");
    bouton('Annuler').click(); await fx.whenStable();
    expect(api.action).not.toHaveBeenCalled();
    bouton('Abandonner').click(); await fx.whenStable();
    [...(fx.nativeElement as HTMLElement).querySelectorAll('.dialogue button')].find(b => b.textContent!.trim() === 'Abandonner')!.dispatchEvent(new Event('click'));
    await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'abandon', {});
    expect(texte()).toContain('Tâche abandonnée.');
  });

  it('Recharger relit le dossier ; une erreur de chargement est visible', async () => {
    const { bouton, attendre, texte } = await ouvrir();
    api.validation.mockRejectedValue(new Error('indisponible'));
    bouton('Recharger').click();
    await attendre();
    expect(api.validation).toHaveBeenCalledTimes(2);
    expect(texte()).toContain('indisponible');
  });
});
