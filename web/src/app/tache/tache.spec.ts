import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import type { EntreeJournal, FicheTache, Tache, TypeDocument } from '../modeles';
import { TacheVue } from './tache';

const tache = (o: Partial<Tache> = {}): Tache => ({
  id: 'T-41', projet: 'Film', titre: 'Ajouter la recherche', cheminProjet: '/depots/film', etape: 'cadrage', statut: 'attente_humain',
  raison: null, echangesPlan: 0, essaisQa: 0, budgetUsd: 6, depenseUsd: 1.2, agent: 'cadreur', ...o,
});
const docs = (o: Partial<Record<TypeDocument, string | null>> = {}): Record<TypeDocument, string | null> => ({
  demande: null, spec: null, criteres: null, plan: null, avis_patron: null, resume: null, rapport: null, avis_patron_code: null, verdict: null, analyse: null, ...o,
});
const fiche = (t: Partial<Tache>, o: Partial<FicheTache> = {}): FicheTache => ({ tache: tache(t), documents: docs(), proposition: null, echanges: [], ...o });
const entree = (id: number, o: Partial<EntreeJournal> = {}): EntreeJournal => ({
  id, tacheId: 'T-41', horodatage: '2026-10-30T09:05:00', type: 'pretooluse', outil: 'Bash', commande: `cmd ${id}`, couche: 'liste_blanche',
  decision: 'autorise', decideur: 'gardien', raison: 'liste blanche', ...o,
});

describe('TacheVue', () => {
  const api = { tache: vi.fn(), journal: vi.fn(), action: vi.fn(), validation: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.resetAllMocks();
    api.journal.mockResolvedValue([]);
    api.action.mockResolvedValue({});
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
  });
  afterEach(() => { vi.useRealTimers(); });

  async function ouvrir(f: FicheTache) {
    api.tache.mockResolvedValue(f);
    const fx = TestBed.createComponent(TacheVue);
    fx.componentRef.setInput('id', 'T-41');
    await fx.whenStable();
    await fx.whenStable();
    const el = fx.nativeElement as HTMLElement;
    const attendre = async () => { await fx.whenStable(); await fx.whenStable(); };
    const bouton = (texte: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === texte);
    return { fx, el, attendre, bouton, texte: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  it('affiche l’en-tête, le titre, l’étape, qui, essai et budget', async () => {
    const { texte } = await ouvrir(fiche({ etape: 'review', statut: 'en_cours', agent: 'reviewer' }));
    expect(texte()).toContain('T-41 · Film');
    expect(texte()).toContain('Ajouter la recherche');
    expect(texte()).toContain('Review');
    expect(texte()).toContain('Reviewer');
    expect(texte()).toContain('essai 1/3');
    expect(texte()).toContain('1,20 $ / 6,00 $');
  });

  it('cadrage en attente de réponse : dernières questions, réponse envoyée, fiche rechargée', async () => {
    const { el, bouton, attendre, texte } = await ouvrir(fiche({ raison: 'le cadreur attend ta réponse' }, {
      echanges: [{ auteur: 'cadreur', texte: 'Ancienne question', creeLe: 'x' }, { auteur: 'moi', texte: 'ok', creeLe: 'x' }, { auteur: 'cadreur', texte: 'Quel format de date ?', creeLe: 'x' }],
    }));
    expect(texte()).toContain('Quel format de date ?');
    expect(texte()).not.toContain('Ancienne question');
    const champ = el.querySelector('textarea')!;
    champ.value = 'ISO 8601'; champ.dispatchEvent(new Event('input'));
    await attendre();
    const avant = api.tache.mock.calls.length;
    bouton('Envoyer')!.click();
    await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'reponse', { texte: 'ISO 8601' });
    expect(api.tache.mock.calls.length).toBeGreaterThan(avant);
  });

  it('cadrage : spec et plan à valider, rendus et validés', async () => {
    const { bouton, attendre, texte } = await ouvrir(fiche({ raison: 'spec et plan à valider' }, {
      proposition: { spec: 'La spec', criteres: ['premier', 'second'], plan: 'Le plan' },
    }));
    expect(texte()).toContain('spec.md · rendu');
    expect(texte()).toContain('La spec');
    expect(texte()).toContain('C1');
    expect(texte()).toContain('premier');
    expect(texte()).toContain('C2');
    expect(texte()).toContain('plan.md · rendu');
    expect(texte()).toContain('Le plan');
    bouton('Valider la spec et le plan')!.click();
    await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'validation-cadrage', {});
    expect(api.tache.mock.calls.length).toBeGreaterThan(1);
  });

  it('patron_plan en attente : note du patron et arbitrage dans les deux sens', async () => {
    const { bouton, attendre, texte } = await ouvrir(fiche({ etape: 'patron_plan' }, { documents: docs({ avis_patron: 'Je propose autre chose' }) }));
    expect(texte()).toContain('Je propose autre chose');
    bouton("Garder l'approche du cadreur")!.click();
    await attendre();
    expect(api.action).toHaveBeenLastCalledWith('T-41', 'arbitrage', { choix: 'cadreur' });
    expect(api.tache.mock.calls.length).toBeGreaterThan(1);
    bouton("Adopter l'alternative")!.click();
    await attendre();
    expect(api.action).toHaveBeenLastCalledWith('T-41', 'arbitrage', { choix: 'alternative' });
  });

  it('pause budget : message, plafond et +2,00 $', async () => {
    const { bouton, attendre, texte } = await ouvrir(fiche({ etape: 'implementation', statut: 'en_pause', raison: 'budget : 6,10 $', depenseUsd: 6.1 }));
    expect(texte()).toContain('Budget de la tâche dépassé');
    expect(texte()).toContain('6,10 $ consommés sur un plafond de 6,00 $');
    bouton('Continuer (+ 2,00 $)')!.click();
    await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'budget', { montantUsd: 2 });
    expect(api.tache.mock.calls.length).toBeGreaterThan(1);
  });

  it.each([
    ['en_pause', 'integrite : spec altérée'],
    ['en_pause', 'arret_global : arrêt demandé'],
    ['en_pause', 'erreur_api : 529'],
    ['bloquee', 'durée maximale dépassée'],
  ] as const)('%s / %s : raison complète et reprise', async (statut, raison) => {
    const { bouton, attendre, texte } = await ouvrir(fiche({ etape: 'implementation', statut, raison }));
    expect(texte()).toContain(raison);
    bouton('Reprendre')!.click();
    await attendre();
    expect(api.action).toHaveBeenCalledWith('T-41', 'reprise', {});
    expect(api.tache.mock.calls.length).toBeGreaterThan(1);
  });

  it('pause escalade : attente au poste de sécurité, lien, pas de bouton de reprise', async () => {
    const { el, bouton, texte } = await ouvrir(fiche({ etape: 'implementation', statut: 'en_pause', raison: 'escalade : rm -rf' }));
    expect(texte()).toContain('En attente de ta décision au poste de sécurité');
    expect(el.querySelector('a[href="/securite"]')).not.toBeNull();
    expect(bouton('Reprendre')).toBeUndefined();
  });

  it('validation en attente : la boîte de validation est chargée une seule fois malgré l’interrogation', async () => {
    api.validation.mockResolvedValue({
      branche: 'tache/T-41', sha: 'a'.repeat(40), commits: 2, fichiers: [], diff: '', tronque: false, integrite: { verifiee: true }, journal: { commandes: 0, refus: 0, escalades: 0 },
    });
    const { texte, fx, attendre } = await ouvrir(fiche({ etape: 'validation' }, { documents: docs({ resume: 'Résumé de fin' }) }));
    expect(texte()).toContain('Intégrité vérifiée');
    expect(texte()).toContain('Résumé de fin');
    vi.advanceTimersByTime(3000); await attendre();
    vi.advanceTimersByTime(3000); await attendre();
    expect(api.tache.mock.calls.length).toBeGreaterThan(2);
    expect(api.validation).toHaveBeenCalledTimes(1);
    fx.destroy();
  });

  it('une erreur 409 de l’action s’affiche telle quelle', async () => {
    api.action.mockRejectedValue(new Error('la tâche n’attend pas cette action'));
    const { el, bouton, attendre } = await ouvrir(fiche({ raison: 'spec et plan à valider' }, { proposition: { spec: 's', criteres: [], plan: 'p' } }));
    bouton('Valider la spec et le plan')!.click();
    await attendre();
    expect(el.querySelector('.alerte')!.textContent).toContain('la tâche n’attend pas cette action');
  });

  it('une fiche avec anomalie : bandeau, onglets conservés, aucun document', async () => {
    const { el, bouton, attendre, texte } = await ouvrir({ tache: tache({ etape: 'implementation', statut: 'en_cours' }), anomalie: 'spec.md modifiée' });
    expect(texte()).toContain("Anomalie d'intégrité : spec.md modifiée");
    expect(el.querySelectorAll('pre').length).toBe(0);
    expect(texte()).toContain('Documents indisponibles : anomalie d\'intégrité');
    bouton('Rapport')!.click();
    await attendre();
    expect(texte()).toContain('Documents indisponibles : anomalie d\'intégrité');
    expect(texte()).not.toContain('Rapport en construction');
    api.journal.mockResolvedValue([entree(7, { commande: 'lecture des documents', decision: 'refuse' })]);
    await vi.advanceTimersByTimeAsync(3000);
    await attendre();
    bouton('Activité')!.click();
    await attendre();
    expect(texte()).toContain('lecture des documents');
  });

  it('une fiche avec anomalie n’est plus relue par l’interrogation, seulement sur demande', async () => {
    const { bouton, attendre } = await ouvrir({ tache: tache({ statut: 'en_cours' }), anomalie: 'spec.md modifiée' });
    expect(api.tache).toHaveBeenCalledTimes(1);
    const j = api.journal.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    await attendre();
    expect(api.tache).toHaveBeenCalledTimes(1);
    expect(api.journal.mock.calls.length).toBeGreaterThan(j);
    bouton('Recharger')!.click();
    await attendre();
    expect(api.tache).toHaveBeenCalledTimes(2);
  });

  it('une tâche en cours n’affiche aucun bouton d’action', async () => {
    const { el } = await ouvrir(fiche({ etape: 'implementation', statut: 'en_cours' }));
    const textes = [...el.querySelectorAll('button')].map(b => b.textContent!.trim());
    expect(textes).toEqual(['Documents', 'Rapport', 'Activité']);
  });

  it('l’erreur d’une action est effacée par l’action suivante réussie, sans masquer l’erreur de chargement', async () => {
    api.action.mockRejectedValueOnce(new Error('refus'));
    const { el, bouton, attendre } = await ouvrir(fiche({ etape: 'implementation', statut: 'en_pause', raison: 'erreur_api : 529' }));
    bouton('Reprendre')!.click();
    await attendre();
    expect(el.textContent).toContain('refus');
    bouton('Reprendre')!.click();
    await attendre();
    expect(el.textContent).not.toContain('refus');
  });

  it('une spec contenant <script> est rendue en texte', async () => {
    const { el, texte } = await ouvrir(fiche({ etape: 'implementation', statut: 'en_cours' }, { documents: docs({ spec: '<script>alert(1)</script><b>x</b>' }) }));
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('pre b')).toBeNull();
    expect(texte()).toContain('<script>alert(1)</script>');
  });

  it('documents présents seulement, onglet Rapport et Activité', async () => {
    api.journal.mockResolvedValue([entree(1), entree(2, { decision: 'refuse', decideur: 'gardien', raison: 'liste noire' })]);
    const { el, bouton, attendre, texte } = await ouvrir(fiche({ etape: 'review', statut: 'en_cours' }, { documents: docs({ demande: 'Ma demande', plan: 'Mon plan', rapport: 'Texte reviewer' }) }));
    expect(texte()).toContain('Ma demande');
    expect(texte()).toContain('Mon plan');
    expect(texte()).not.toContain('Avis du patron');
    bouton('Rapport')!.click();
    await attendre();
    expect(texte()).toContain('Rapport en construction');
    expect(texte()).toContain('Texte reviewer');
    bouton('Activité')!.click();
    await attendre();
    const lignes = [...el.querySelectorAll('.activite li')].map(l => l.textContent!.replace(/\s+/g, ' '));
    expect(lignes[0]).toContain('cmd 2');
    expect(lignes[0]).toContain('refuse');
    expect(lignes[0]).toContain('gardien · liste noire');
    expect(lignes[1]).toContain('09:05');
  });

  it('recharge toutes les 3 s tant que la vue est ouverte, puis s’arrête à la destruction', async () => {
    const { fx, attendre } = await ouvrir(fiche({ etape: 'review', statut: 'en_cours' }));
    const n = api.tache.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    await attendre();
    expect(api.tache.mock.calls.length).toBe(n + 1);
    expect(api.journal).toHaveBeenCalledWith('T-41');
    fx.destroy();
    await vi.advanceTimersByTimeAsync(9000);
    expect(api.tache.mock.calls.length).toBe(n + 1);
  });
});
