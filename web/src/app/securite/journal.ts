import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ApiService } from '../api';
import { heure } from '../libelles';
import type { EntreeJournal, IntegriteJournal } from '../modeles';

const MAX = 500;
const DECISIONS = ['Autorisé', 'Refusé', 'Escaladé'];

@Component({
  selector: 'app-journal',
  template: `
    <section class="ecran">
      <h1>Poste de sécurité · Journal des commandes</h1>
      @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
      @if (integrite(); as i) {
        @if (i.intacte) { <p class="go">✓ Chaîne intacte sur {{ i.entrees }} entrées</p> }
        @else { <p class="nogo">✕ Chaîne rompue : {{ i.erreur }}</p> }
      }
      <label>Tâche
        <select aria-label="Tâche" [value]="filtreTache()" (change)="filtreTache.set($any($event.target).value)">
          <option value="">Toutes</option>
          @for (t of taches(); track t) { <option [value]="t">{{ t }}</option> }
        </select>
      </label>
      <label>Décision
        <select aria-label="Décision" [value]="filtreDecision()" (change)="filtreDecision.set($any($event.target).value)">
          <option value="">Toutes</option>
          @for (d of decisions; track d) { <option [value]="d">{{ d }}</option> }
        </select>
      </label>
      @if (tronque()) { <p class="doux">{{ max }} plus récentes sur {{ filtrees().length }}</p> }
      <table>
        <thead><tr><th>Heure</th><th>Tâche</th><th>Commande</th><th>Couche</th><th>Décision</th><th>Décideur</th><th>Raison</th></tr></thead>
        <tbody>
          @for (e of affichees(); track e.id) {
            <tr>
              <td class="mono">{{ heure(e.horodatage) }}</td><td class="mono">{{ e.tacheId }}</td><td class="mono">{{ e.commande }}</td>
              <td>{{ e.couche }}</td><td>{{ e.decision }}</td><td>{{ e.decideur }}</td><td>{{ e.raison }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class Journal implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly minuteur: ReturnType<typeof setInterval>;
  protected readonly heure = heure;
  protected readonly max = MAX;
  protected readonly decisions = DECISIONS;
  protected readonly entrees = signal<EntreeJournal[]>([]);
  protected readonly integrite = signal<IntegriteJournal | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly filtreTache = signal('');
  protected readonly filtreDecision = signal('');
  protected readonly taches = computed(() => [...new Set(this.entrees().map(e => e.tacheId))].sort());
  protected readonly filtrees = computed(() => this.entrees()
    .filter(e => (!this.filtreTache() || e.tacheId === this.filtreTache()) && (!this.filtreDecision() || e.decision === this.filtreDecision()))
    .sort((a, b) => b.id - a.id));
  protected readonly affichees = computed(() => this.filtrees().slice(0, MAX));
  protected readonly tronque = computed(() => this.filtrees().length > MAX);

  constructor() {
    void this.charger();
    this.minuteur = setInterval(() => void this.charger(), 3000);
  }
  ngOnDestroy(): void { clearInterval(this.minuteur); }

  private enCours = false;
  private async charger(): Promise<void> {
    if (this.enCours) return;
    this.enCours = true;
    try {
      const [entrees, integrite] = await Promise.all([this.api.journal(), this.api.integrite()]);
      this.entrees.set(entrees); this.integrite.set(integrite); this.erreur.set(null);
    } catch (e) {
      this.erreur.set((e as Error).message);
    } finally {
      this.enCours = false;
    }
  }
}
