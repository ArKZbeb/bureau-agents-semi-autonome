import { Component, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../api';
import { ConfirmationAbandon } from './confirmation-abandon';
import { commandeVisible } from '../commande-visible';
import { LIBELLE_ETAPE } from '../libelles';
import type { NomAction, Tache } from '../modeles';

const PREFIXE = /^integrite : /;

@Component({
  selector: 'app-alerte',
  imports: [ConfirmationAbandon],
  template: `
    <div class="bloc">
      <h2>Poste de sécurité · Alerte d'intégrité</h2>
      <p class="doux mono">{{ tache().id }} · {{ tache().projet }}</p>
      <h3>{{ tache().titre }}</h3>
      <p class="mono">Étape {{ etape() }} · tâche en pause</p>
      <p class="alerte raison">{{ raison() }}</p>
      @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
      <div class="actions">
        <button class="principal" [disabled]="envoi()" (click)="agir('reprise', {}, 'Tâche reprise.')">Reprendre</button>
        <button [disabled]="envoi()" (click)="agir('relance', { vers: 'implementation' }, 'Tâche relancée.')">Compter comme no-go et relancer</button>
        <button class="danger" [disabled]="envoi()" (click)="dialogue.set(true)">Abandonner la tâche</button>
      </div>
      <p class="doux">Quelle que soit ta décision, elle est consignée dans le journal des commandes.</p>
      @if (dialogue()) {
        <app-confirmation-abandon [id]="tache().id" [occupe]="envoi()" (annuler)="dialogue.set(false)" (confirmer)="agir('abandon', {}, 'Tâche abandonnée.')" />
      }
    </div>`,
  styles: `
    .bloc { background: var(--panneau); border: 1px solid var(--ligne); border-radius: 8px; padding: 12px; margin: 12px 0; }
    .raison { font-weight: bold; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    p { overflow-wrap: anywhere; }
  `,
})
export class AlerteVue {
  readonly tache = input.required<Tache>();
  /** Message de succès, pour que la vue parente recharge la fiche et le garde. */
  readonly fait = output<string>();

  private readonly api = inject(ApiService);
  protected readonly erreur = signal<string | null>(null);
  protected readonly envoi = signal(false);
  protected readonly dialogue = signal(false);

  protected etape() { return LIBELLE_ETAPE[this.tache().etape]; }
  protected raison() { return commandeVisible((this.tache().raison ?? '').replace(PREFIXE, '')).texte; }

  protected async agir(nom: NomAction, corps: Record<string, unknown>, message: string) {
    if (this.envoi()) return;
    this.dialogue.set(false);
    this.envoi.set(true);
    this.erreur.set(null);
    try {
      await this.api.action(this.tache().id, nom, corps);
      this.fait.emit(message);
    } catch (e) {
      this.erreur.set((e as Error).message);
    } finally {
      this.envoi.set(false);
    }
  }
}
