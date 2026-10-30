import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api';
import { EtatBureau } from '../etat';
import type { Detection } from '../modeles';

@Component({
  selector: 'app-relier-projet',
  imports: [FormsModule],
  template: `
    <div class="voile"><section class="dialogue">
      <h2>Relier un projet</h2>
      <h3>1 · Dossier local</h3>
      <div class="ligne">
        <input [(ngModel)]="chemin" placeholder="/chemin/absolu/du/depot" aria-label="Dossier local" />
        <button (click)="detecter()" [disabled]="!chemin.trim()">Détecter</button>
      </div>
      @if (detection(); as d) {
        <h3>2 · Détection</h3>
        <ul class="detection">
          @if (!d.git) { <li class="nogo">✕ Pas un dépôt Git</li> }
          @if (d.dotnet; as n) { <li class="go">✓ .NET <span class="doux">{{ n.solution ?? 'sans solution' }} · {{ n.projets }} projets ({{ n.projetsTests }} de tests)</span></li> }
          @if (d.angular; as a) { <li class="go">✓ Angular <span class="doux">{{ a.fichier }}</span></li> }
          @if (!d.dotnet && !d.angular) { <li class="nogo">✕ Aucune stack .NET ou Angular</li> }
          <li class="doux">Image de base utilisée (SDK .NET, Node, Chrome headless, outils d'analyse)</li>
        </ul>
        <h3>3 · Réglages du projet</h3>
        <label>Nom <input [(ngModel)]="nom" /></label>
        <label>Seuil de couverture (lignes modifiées) <input type="number" min="0" max="100" step="1" [(ngModel)]="seuil" /> %</label>
        <label>Budget par tâche <input type="number" min="0.5" step="0.5" [(ngModel)]="budget" /> $</label>
        <p class="doux">Durée max par étape : 60 min pour l'implémentation, 30 min pour les autres étapes.</p>
        <p class="doux">Au-delà du budget, la tâche s'arrête et demande ton accord. Au-delà de la durée, elle passe en « bloquée ».</p>
      }
      @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
      <footer>
        <button (click)="fermer.emit()">Annuler</button>
        <button class="principal" (click)="relier()" [disabled]="!relieable()">Relier le projet</button>
      </footer>
    </section></div>`,
  styles: `.ligne { display: flex; gap: 8px; } label { display: block; margin: 8px 0; } .detection { list-style: none; padding: 0; }`,
})
export class RelierProjet {
  private readonly api = inject(ApiService);
  private readonly etat = inject(EtatBureau);
  readonly fermer = output<void>();
  protected chemin = '';
  protected nom = '';
  protected seuil = 80;
  protected budget = 6;
  protected readonly detection = signal<Detection | null>(null);
  protected readonly erreur = signal<string | null>(null);

  protected relieable() {
    const d = this.detection();
    return !!d && d.git && (!!d.dotnet || !!d.angular) && this.nom.trim() !== '';
  }
  protected async detecter() {
    this.erreur.set(null);
    try {
      const d = await this.api.detecter(this.chemin.trim());
      this.detection.set(d);
      this.nom = d.nomPropose;
    } catch (e) { this.detection.set(null); this.erreur.set((e as Error).message); }
  }
  protected async relier() {
    this.erreur.set(null);
    try {
      await this.api.relier({ nom: this.nom.trim(), chemin: this.chemin.trim(), budgetUsd: Number(this.budget), couvertureLignes: Number(this.seuil) });
      await this.etat.rafraichir();
      this.fermer.emit();
    } catch (e) { this.erreur.set((e as Error).message); }
  }
}
