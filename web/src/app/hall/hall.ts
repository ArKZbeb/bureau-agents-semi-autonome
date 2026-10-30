import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EtatBureau } from '../etat';
import { ETAPES, LIBELLE_ETAPE, budget, essai, qui } from '../libelles';
import { NouvelleStory } from './nouvelle-story';
import { RelierProjet } from './relier-projet';

@Component({
  selector: 'app-hall',
  imports: [RouterLink, RelierProjet, NouvelleStory],
  template: `
    <section class="ecran">
      <h1>Hall d'entrée · Tableau des tâches</h1>
      @if (!etat.projets().length) {
        <div class="vide">
          <h2>Le bureau est vide</h2>
          <p>Aucun projet relié, aucun agent au travail. Relie un premier dossier local (.NET ou Angular) : le bureau détecte la stack, propose les seuils par défaut, et le cadreur pourra prendre ta première user story.</p>
          <button class="principal" (click)="dialogue.set('relier')">+ Relier un premier projet</button>
        </div>
      } @else {
        <div class="projets">
          @for (p of etat.projets(); track p.nom) { <span class="projet">{{ p.nom }} · {{ nombre(p.nom) }}</span> }
          <button (click)="dialogue.set('relier')">+ Relier un projet</button>
          <button class="principal" (click)="dialogue.set('story')">+ Nouvelle user story</button>
        </div>
        <div class="kanban">
          @for (col of colonnes(); track col.etape) {
            <div class="colonne">
              <h3>{{ col.nom }} <span class="doux">{{ col.taches.length }}</span></h3>
              @for (t of col.taches; track t.id) {
                <a class="carte" [routerLink]="['/taches', t.id]">
                  <div class="doux mono">{{ t.projet }} {{ t.id }}</div>
                  <div>{{ t.titre }}</div>
                  <div class="doux">{{ qui(t) }}</div>
                  <div class="doux mono">{{ essai(t) }} {{ budget(t) }}</div>
                </a>
              }
            </div>
          }
        </div>
      }
      @if (dialogue() === 'relier') { <app-relier-projet (fermer)="dialogue.set(null)" /> }
      @if (dialogue() === 'story') { <app-nouvelle-story (fermer)="dialogue.set(null)" /> }
    </section>`,
  styles: `
    .projets { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .projet { padding: 4px 10px; border: 1px solid var(--ligne); border-radius: 14px; }
    .kanban { display: grid; grid-template-columns: repeat(7, minmax(160px, 1fr)); gap: 10px; overflow-x: auto; }
    .colonne { background: var(--panneau); border: 1px solid var(--ligne); border-radius: 8px; padding: 8px; min-height: 200px; }
    .colonne h3 { margin: 0 0 8px; font-size: 13px; }
    .carte { display: block; background: var(--carte); border: 1px solid var(--ligne); border-radius: 6px; padding: 8px; margin-bottom: 8px; color: var(--texte); text-decoration: none; }
  `,
})
export class Hall {
  protected readonly etat = inject(EtatBureau);
  protected readonly dialogue = signal<'relier' | 'story' | null>(null);
  protected readonly qui = qui; protected readonly essai = essai; protected readonly budget = budget;
  protected readonly colonnes = computed(() => {
    const actives = this.etat.taches().filter(t => t.statut !== 'terminee' && t.statut !== 'abandonnee');
    return ETAPES.map(etape => ({ etape, nom: LIBELLE_ETAPE[etape], taches: actives.filter(t => t.etape === etape) }));
  });
  protected nombre(projet: string) { return this.etat.taches().filter(t => t.projet === projet).length; }
}
