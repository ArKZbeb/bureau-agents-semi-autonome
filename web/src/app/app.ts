import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService, JETON } from './api';
import { EtatBureau } from './etat';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (!jeton) {
      <main class="vide">
        <h1>Jeton de session manquant</h1>
        <p>Ouvre le lien affiché par l'orchestrateur au démarrage (<code>npm run demarrer</code>).</p>
      </main>
    } @else {
      <header class="barre">
        <strong>Bureau d'agents</strong>
        <nav>
          <a routerLink="/" routerLinkActive="actif" [routerLinkActiveOptions]="{ exact: true }">Hall d'entrée</a>
          <a routerLink="/securite" routerLinkActive="actif">Poste de sécurité
            @if (etat.escalades().length) { <span class="pastille">{{ etat.escalades().length }}</span> }
          </a>
          <a routerLink="/journal" routerLinkActive="actif">Journal des commandes</a>
        </nav>
        @if (etat.etat().ordonnanceur === 'actif') {
          <button class="danger" (click)="confirmation.set('arret')">■ Arrêt global</button>
        } @else {
          <button (click)="confirmation.set('reprise')">▶ Tout reprendre</button>
        }
      </header>
      @if (etat.erreur(); as e) { <p class="alerte">Orchestrateur injoignable : {{ e }}</p> }
      @if (echecAction(); as m) { <p class="alerte">{{ m }}</p> }
      <router-outlet />
      @if (confirmation() === 'arret') {
        <div class="voile"><section class="dialogue">
          <h2>Arrêt global ?</h2>
          <p>Les conteneurs sont stoppés immédiatement et les tâches en cours passent en pause. Rien n'est perdu : spec, plan, branches et rapports sont conservés hors conteneur, et chaque tâche reprendra à sa dernière étape terminée. Aucun repo n'est touché.</p>
          <footer><button (click)="confirmation.set(null)">Annuler</button><button class="danger" (click)="arret()">Tout arrêter</button></footer>
        </section></div>
      }
      @if (confirmation() === 'reprise') {
        <div class="voile"><section class="dialogue">
          <h2>Tout reprendre ?</h2>
          <p>L'ordonnanceur redémarre. Les tâches en pause le restent : reprends chacune depuis son panneau. Les tâches qui attendaient ta décision (escalade, intégrité, budget) restent en attente.</p>
          <footer><button (click)="confirmation.set(null)">Annuler</button><button (click)="reprise()">Reprendre</button></footer>
        </section></div>
      }
    }`,
})
export class App implements OnInit, OnDestroy {
  protected readonly jeton = inject(JETON);
  protected readonly etat = inject(EtatBureau);
  private readonly api = inject(ApiService);
  protected readonly confirmation = signal<'arret' | 'reprise' | null>(null);

  ngOnInit() { if (this.jeton) this.etat.demarrer(); }
  ngOnDestroy() { this.etat.arreter(); }
  protected readonly echecAction = signal<string | null>(null);

  protected arret() { return this.globale(() => this.api.arretGlobal(), 'Arrêt global impossible'); }
  protected reprise() { return this.globale(() => this.api.repriseGlobale(), 'Reprise globale impossible'); }

  private async globale(appel: () => Promise<unknown>, prefixe: string) {
    this.confirmation.set(null);
    this.echecAction.set(null);
    try { await appel(); } catch (e) { this.echecAction.set(`${prefixe} : ${(e as Error).message}`); }
    await this.etat.rafraichir();
  }
}
