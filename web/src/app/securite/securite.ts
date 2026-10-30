import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';
import { heure } from '../libelles';
import type { Escalade } from '../modeles';

/** `entree` est le JSON de l'entrée de l'outil ; analysé avec prudence, affiché comme texte seulement. */
function commandeDe(e: Escalade): { commande: string | null; brut: string } {
  if (e.outil === 'Bash') {
    try {
      const v: unknown = JSON.parse(e.entree);
      const c = typeof v === 'object' && v !== null ? (v as { command?: unknown }).command : undefined;
      if (typeof c === 'string') return { commande: c, brut: e.entree };
    } catch { /* affichage brut */ }
  }
  return { commande: null, brut: e.entree };
}

@Component({
  selector: 'app-securite',
  template: `
    <section class="ecran">
      <h1>Poste de sécurité · Commande escaladée</h1>
      @if (message(); as m) { <p class="alerte">{{ m }}</p> }
      @if (confirmation(); as c) { <p class="doux">{{ c }}</p> }
      @for (e of etat.escalades(); track e.id) {
        <div class="bloc">
          <p><strong class="mono">{{ e.tacheId }}</strong> · Tâche en pause depuis {{ heure(e.creeLe) }}</p>
          @if (affichage(e); as a) {
            @if (a.commande !== null) { <pre class="mono">$ {{ a.commande }}</pre> }
            @else { <pre class="mono">{{ e.outil }} {{ a.brut }}</pre> }
          }
          <h3>Raison donnée par le gardien</h3>
          <p>{{ e.raison }}</p>
          <input type="text" aria-label="Commentaire (facultatif)" placeholder="Commentaire (facultatif)" [value]="commentaire()" (input)="commentaire.set($any($event.target).value)" />
          <button class="principal" [disabled]="envoi()" (click)="decider(e, 'approuver')">Autoriser</button>
          <button class="danger" [disabled]="envoi()" (click)="decider(e, 'refuser')">Refuser</button>
        </div>
      } @empty {
        <p class="doux">Aucune commande en attente.</p>
      }
    </section>
  `,
})
export class Securite {
  private readonly api = inject(ApiService);
  protected readonly etat = inject(EtatBureau);
  protected readonly heure = heure;
  protected readonly commentaire = signal('');
  protected readonly envoi = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly confirmation = signal<string | null>(null);
  protected readonly affichage = commandeDe;

  protected async decider(e: Escalade, decision: 'approuver' | 'refuser'): Promise<void> {
    if (this.envoi()) return;
    this.envoi.set(true); this.message.set(null); this.confirmation.set(null);
    try {
      const t = await this.api.deciderEscalade(e.id, decision, this.commentaire());
      this.confirmation.set(`Décision enregistrée : la tâche ${t.id} reprend (${t.statut}).`);
      this.commentaire.set('');
    } catch (err) {
      this.message.set((err as Error).message);
    } finally {
      this.envoi.set(false);
    }
    await this.etat.rafraichir();
  }
}
