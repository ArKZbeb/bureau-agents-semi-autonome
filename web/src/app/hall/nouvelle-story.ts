import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';

@Component({
  selector: 'app-nouvelle-story',
  imports: [FormsModule],
  template: `
    <div class="voile"><section class="dialogue">
      <h2>Nouvelle user story</h2>
      <label>Projet
        <select [(ngModel)]="projet">
          @for (p of etat.projets(); track p.nom) { <option [value]="p.nom">{{ p.nom }}</option> }
        </select>
      </label>
      <label>Titre <input [(ngModel)]="titre" /></label>
      <label>Description libre <textarea rows="8" [(ngModel)]="demande"></textarea></label>
      <p class="doux">Le cadreur part d'un contexte vierge : il lit le repo, ta demande et la maquette éventuelle, puis te propose spec.md et plan.md.</p>
      @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
      <footer>
        <button (click)="fermer.emit()">Annuler</button>
        <button class="principal" [disabled]="envoi() || !projet || !titre.trim() || !demande.trim()" (click)="envoyer()">Envoyer au cadreur</button>
      </footer>
    </section></div>`,
  styles: `label { display: block; margin: 8px 0; }`,
})
export class NouvelleStory {
  private readonly api = inject(ApiService);
  protected readonly etat = inject(EtatBureau);
  readonly fermer = output<void>();
  protected projet = this.etat.projets()[0]?.nom ?? '';
  protected titre = '';
  protected demande = '';
  protected readonly envoi = signal(false);
  protected readonly erreur = signal<string | null>(null);

  protected async envoyer() {
    this.envoi.set(true);
    this.erreur.set(null);
    try {
      await this.api.creerTache({ projet: this.projet, titre: this.titre.trim(), demande: this.demande.trim() });
      await this.etat.rafraichir();
      this.fermer.emit();
    } catch (e) { this.erreur.set((e as Error).message); } finally { this.envoi.set(false); }
  }
}
