import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EtatBureau } from '../etat';
import { aValider, budget } from '../libelles';

@Component({
  selector: 'app-bureau',
  imports: [RouterLink],
  template: `
    <section class="ecran">
      <h1>Mon bureau · Boîte de validation</h1>
      @if (!aValider().length && !bloquees().length) {
        <p class="doux">Rien à valider pour l'instant.</p>
      }
      @if (aValider().length) {
        <h2>À valider</h2>
        @for (t of aValider(); track t.id) {
          <a class="carte" [routerLink]="['/taches', t.id]">
            <div class="doux mono">{{ t.id }} · {{ t.projet }}</div>
            <div>{{ t.titre }}</div>
            <div class="doux mono">{{ budget(t) }}</div>
          </a>
        }
      }
      @if (bloquees().length) {
        <h2>Bloquées</h2>
        @for (t of bloquees(); track t.id) {
          <a class="carte" [routerLink]="['/taches', t.id]">
            <div class="doux mono">{{ t.id }} · {{ t.projet }}</div>
            <div>{{ t.titre }}</div>
            <div class="doux mono">{{ budget(t) }}</div>
          </a>
        }
      }
    </section>`,
  styles: `
    .carte { display: block; background: var(--carte); border: 1px solid var(--ligne); border-radius: 6px; padding: 8px; margin-bottom: 8px; color: var(--texte); text-decoration: none; max-width: 640px; }
  `,
})
export class Bureau {
  private readonly etat = inject(EtatBureau);
  protected readonly budget = budget;
  protected readonly aValider = computed(() => this.etat.taches().filter(aValider));
  protected readonly bloquees = computed(() => this.etat.taches().filter(t => t.statut === 'bloquee'));
}
