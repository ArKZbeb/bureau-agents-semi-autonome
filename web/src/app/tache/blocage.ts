import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ApiService } from '../api';
import { commandeVisible } from '../commande-visible';
import { budget, heure } from '../libelles';
import type { EntreeHistorique, NomAction, Tache } from '../modeles';

@Component({
  selector: 'app-blocage',
  template: `
    <div class="bloc">
      <h2>Mon bureau · Tâche bloquée</h2>
      <p class="doux mono">{{ tache().id }} · {{ tache().projet }}</p>
      <h3>{{ tache().titre }}</h3>
      <p class="mono">{{ tache().essaisQa }} no-go · {{ budget(tache()) }}</p>
      <h3>Résumé du blocage</h3>
      <p>{{ visible(tache().raison ?? '') }}</p>
      @if (derniere(); as d) {
        @if (d.regles.length) { <ul>@for (r of d.regles; track $index) { <li>{{ visible(r) }}</li> }</ul> }
        @if (d.criteresNonRemplis.length) {
          <ul>@for (c of d.criteresNonRemplis; track c.numero) { <li class="mono">C{{ c.numero }} · Preuve : {{ visible(c.preuve) }}</li> }</ul>
        }
      }
      @if (erreurChargement(); as e) { <p class="alerte">{{ e }}</p> }
      <h3>Historique des {{ historique().length }} essais</h3>
      <ul class="activite">
        @for (h of historique(); track $index) {
          <li><span class="mono">{{ heure(h.creeLe) }}</span> <strong [class]="h.verdict === 'go' ? 'go' : 'nogo'">{{ h.verdict === 'go' ? 'GO' : 'NO-GO' }}</strong> @for (r of h.regles; track $index) { <span> · {{ visible(r) }}</span> }</li>
        }
      </ul>
      <p class="doux">Le dossier complet (spec, plan, diffs, rapports, verdicts, journal) reste dans le bureau. Rien n'a touché le repo {{ tache().projet }}.</p>
      @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
      <div class="actions">
        <button class="principal" [disabled]="envoi()" (click)="agir('reprise', {})">Relancer</button>
        <button [disabled]="envoi()" (click)="agir('relance', { vers: 'cadrage' })">Reprendre le cadrage</button>
        <button [disabled]="envoi()" (click)="dialogue.set('commentaire')">Relancer avec commentaire</button>
        <button class="danger" [disabled]="envoi()" (click)="dialogue.set('abandon')">Abandonner</button>
      </div>
      @if (dialogue() === 'commentaire') {
        <div class="voile"><section class="dialogue">
          <h2>Relancer avec commentaire</h2>
          <textarea rows="5" aria-label="Commentaire" [value]="commentaire()" (input)="commentaire.set($any($event.target).value)"></textarea>
          <footer>
            <button (click)="dialogue.set(null)">Annuler</button>
            <button class="principal" [disabled]="envoi() || !commentaire().trim()" (click)="relancer()">Relancer</button>
          </footer>
        </section></div>
      }
      @if (dialogue() === 'abandon') {
        <div class="voile"><section class="dialogue">
          <h2>Abandonner {{ tache().id }} ?</h2>
          <p>Abandonner {{ tache().id }} ? La branche n'est pas récupérée et l'espace de la tâche est supprimé.</p>
          <footer>
            <button (click)="dialogue.set(null)">Annuler</button>
            <button class="danger" [disabled]="envoi()" (click)="abandonner()">Abandonner</button>
          </footer>
        </section></div>
      }
    </div>`,
  styles: `
    .bloc { background: var(--panneau); border: 1px solid var(--ligne); border-radius: 8px; padding: 12px; margin: 12px 0; }
    .activite { list-style: none; padding: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    p, li { overflow-wrap: anywhere; }
  `,
})
export class BlocageVue {
  readonly tache = input.required<Tache>();
  /** Message de succès, pour que la vue parente recharge la fiche et le garde. */
  readonly fait = output<string>();

  private readonly api = inject(ApiService);
  protected readonly historique = signal<EntreeHistorique[]>([]);
  protected readonly erreurChargement = signal<string | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly envoi = signal(false);
  protected readonly dialogue = signal<'commentaire' | 'abandon' | null>(null);
  protected readonly commentaire = signal('');
  protected readonly budget = budget;
  protected readonly heure = heure;
  protected readonly derniere = computed(() => this.historique()[0] ?? null);
  private chargement = 0;

  constructor() {
    // Une lecture par tâche affichée ; pas d'interrogation périodique.
    effect(() => {
      const id = this.tache().id;
      untracked(() => void this.charger(id));
    });
  }

  protected visible(t: string) { return commandeVisible(t).texte; }

  private async charger(id: string) {
    const n = ++this.chargement;
    try {
      const h = await this.api.historique(id);
      if (n === this.chargement) { this.historique.set(h); this.erreurChargement.set(null); }
    } catch (e) {
      if (n === this.chargement) this.erreurChargement.set((e as Error).message);
    }
  }

  protected async agir(nom: NomAction, corps: Record<string, unknown>, message = 'Tâche relancée.') {
    if (this.envoi()) return;
    this.dialogue.set(null);
    this.envoi.set(true);
    this.erreur.set(null);
    try {
      await this.api.action(this.tache().id, nom, corps);
      this.fait.emit(message);
      void this.charger(this.tache().id);
    } catch (e) {
      this.erreur.set((e as Error).message);
    } finally {
      this.envoi.set(false);
    }
  }
  protected async relancer() {
    const commentaire = this.commentaire().trim();
    if (!commentaire) return;
    await this.agir('relance', { vers: 'implementation', commentaire });
    if (this.erreur() === null) this.commentaire.set('');
  }
  protected abandonner() { return this.agir('abandon', {}, 'Tâche abandonnée.'); }
}
