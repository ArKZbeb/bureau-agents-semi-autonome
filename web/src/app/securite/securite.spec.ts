import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';
import type { Escalade } from '../modeles';
import { Securite } from './securite';

const esc = (o: Partial<Escalade> = {}): Escalade => ({
  id: 1, tacheId: 'T-41', outil: 'Bash', entree: JSON.stringify({ command: 'npm install csv-parsr@0.1.2' }),
  raison: 'paquet inconnu du registre', creeLe: '2026-10-30T09:05:00', ...o,
});

describe('Securite', () => {
  const api = { deciderEscalade: vi.fn() };
  const etat = { escalades: signal<Escalade[]>([]), rafraichir: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    etat.escalades.set([]);
    etat.rafraichir.mockResolvedValue(undefined);
    api.deciderEscalade.mockResolvedValue({ id: 'T-41', statut: 'en_cours' });
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, { provide: EtatBureau, useValue: etat }] });
  });

  async function ouvrir(escalades: Escalade[]) {
    etat.escalades.set(escalades);
    const fx = TestBed.createComponent(Securite);
    await fx.whenStable();
    const el = fx.nativeElement as HTMLElement;
    const bouton = (t: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === t)!;
    return { fx, el, bouton, texte: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  it('sans escalade : message vide', async () => {
    const { texte } = await ouvrir([]);
    expect(texte()).toContain('Poste de sécurité · Commande escaladée');
    expect(texte()).toContain('Aucune commande en attente.');
  });

  it('affiche tâche, heure, commande Bash et raison', async () => {
    const { texte } = await ouvrir([esc()]);
    expect(texte()).toContain('T-41');
    expect(texte()).toContain('Tâche en pause depuis 09:05');
    expect(texte()).toContain('$ npm install csv-parsr@0.1.2');
    expect(texte()).toContain('Raison donnée par le gardien');
    expect(texte()).toContain('paquet inconnu du registre');
  });

  it('entrée non JSON : outil puis entrée brute', async () => {
    const { texte } = await ouvrir([esc({ outil: 'Write', entree: 'pas du json <b>x</b>' })]);
    expect(texte()).toContain('Write');
    expect(texte()).toContain('pas du json <b>x</b>');
  });

  it('Autoriser avec commentaire : une seule décision malgré deux clics, statut affiché, état rafraîchi', async () => {
    const { el, bouton, fx, texte } = await ouvrir([esc()]);
    const champ = el.querySelector('input,textarea') as HTMLInputElement;
    champ.value = 'ok'; champ.dispatchEvent(new Event('input'));
    bouton('Autoriser').click(); bouton('Autoriser').click();
    await fx.whenStable();
    expect(api.deciderEscalade).toHaveBeenCalledTimes(1);
    expect(api.deciderEscalade).toHaveBeenCalledWith(1, 'approuver', 'ok');
    expect(etat.rafraichir).toHaveBeenCalled();
    expect(texte()).toContain('Décision enregistrée : la tâche T-41 reprend (en_cours).');
  });

  it('Refuser appelle refuser', async () => {
    const { bouton, fx } = await ouvrir([esc()]);
    bouton('Refuser').click();
    await fx.whenStable();
    expect(api.deciderEscalade).toHaveBeenCalledWith(1, 'refuser', '');
  });

  it('boutons désactivés pendant l’appel', async () => {
    let fin!: (t: unknown) => void;
    api.deciderEscalade.mockReturnValue(new Promise(r => { fin = r; }));
    const { bouton, fx } = await ouvrir([esc()]);
    bouton('Autoriser').click();
    await fx.whenStable();
    expect((bouton('Autoriser') as HTMLButtonElement).disabled).toBe(true);
    expect((bouton('Refuser') as HTMLButtonElement).disabled).toBe(true);
    fin({ id: 'T-41', statut: 'en_cours' });
    await fx.whenStable();
  });

  it('erreur de l’API affichée et boutons réactivés', async () => {
    api.deciderEscalade.mockRejectedValue(new Error('escalade 3 introuvable ou déjà tranchée'));
    const { bouton, fx, texte } = await ouvrir([esc()]);
    bouton('Autoriser').click();
    await fx.whenStable();
    expect(texte()).toContain('escalade 3 introuvable ou déjà tranchée');
    expect((bouton('Autoriser') as HTMLButtonElement).disabled).toBe(false);
  });
});
