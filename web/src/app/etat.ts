import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api';
import type { Escalade, EtatGlobal, Projet, Tache } from './modeles';

@Injectable({ providedIn: 'root' })
export class EtatBureau {
  private readonly api = inject(ApiService);
  private minuteur: ReturnType<typeof setInterval> | undefined;
  readonly taches = signal<Tache[]>([]);
  readonly escalades = signal<Escalade[]>([]);
  readonly projets = signal<Projet[]>([]);
  readonly etat = signal<EtatGlobal>({ ordonnanceur: 'actif' });
  readonly erreur = signal<string | null>(null);

  private enCours = false;

  async rafraichir(): Promise<void> {
    if (this.enCours) return;
    this.enCours = true;
    try {
      const [taches, escalades, projets, etat] = await Promise.all([this.api.taches(), this.api.escalades(), this.api.projets(), this.api.etat()]);
      this.taches.set(taches); this.escalades.set(escalades); this.projets.set(projets); this.etat.set(etat);
      this.erreur.set(null);
    } catch (e) {
      this.erreur.set((e as Error).message);
    } finally {
      this.enCours = false;
    }
  }
  demarrer(): void {
    if (this.minuteur !== undefined) return;
    void this.rafraichir();
    this.minuteur = setInterval(() => void this.rafraichir(), 3000);
  }
  arreter(): void { clearInterval(this.minuteur); this.minuteur = undefined; }
}
