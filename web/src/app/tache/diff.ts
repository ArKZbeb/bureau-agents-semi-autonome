import { Component, computed, input, signal } from '@angular/core';
import { commandeVisible } from '../commande-visible';
import type { FichierModifie } from '../modeles';

type Ligne = { texte: string; classe: 'ajout' | 'retrait' | 'entete' | '' };

const classeDe = (l: string): Ligne['classe'] => {
  if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@') || l.startsWith('diff --git ') || l.startsWith('index ')) return 'entete';
  if (l.startsWith('+')) return 'ajout';
  if (l.startsWith('-')) return 'retrait';
  return '';
};

/** Découpe le diff en sections, une par ligne `diff --git `. */
function sections(diff: string): string[][] {
  const res: string[][] = [];
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ') || !res.length) res.push([]);
    res[res.length - 1].push(l);
  }
  return res;
}

/** Le diff est une donnée hostile : chaque ligne passe par `commandeVisible`, rendue par interpolation seule. */
@Component({
  selector: 'app-diff',
  template: `
    @if (donnees().tronque) { <p class="alerte">Diff tronqué : récupère la branche pour tout voir</p> }
    @if (suspecte()) { <p class="alerte">Caractères invisibles ou de contrôle présents dans le diff</p> }
    <ul class="fichiers">
      @for (f of fichiers(); track $index) {
        <li>
          <button [class.actif]="choisi() === f.fichier" (click)="choisir(f.fichier)">
            <span class="mono">{{ f.nom }}</span>
            @if (f.binaire) { <span class="doux"> binaire</span> } @else { <span class="go"> +{{ f.ajouts }}</span> <span class="nogo">−{{ f.suppressions }}</span> }
          </button>
        </li>
      }
    </ul>
    <pre class="diff">@for (l of lignes(); track $index) {<span [class]="l.classe">{{ l.texte }}</span>}</pre>`,
  styles: `
    .fichiers { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .fichiers .actif { border-color: var(--accent); }
    .diff { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--fm); background: var(--panneau); border: 1px solid var(--ligne); border-radius: 6px; padding: 8px; }
    .diff span { display: block; min-height: 1.45em; }
    .ajout { color: var(--ok); } .retrait { color: var(--ko); } .entete { color: var(--doux); }
  `,
})
export class DiffVue {
  readonly donnees = input.required<{ diff: string; fichiers: FichierModifie[]; tronque: boolean }>();
  protected readonly choisi = signal<string | null>(null);

  protected readonly fichiers = computed(() => this.donnees().fichiers.map(f => ({
    ...f, nom: commandeVisible(f.fichier).texte, binaire: f.ajouts === null || f.suppressions === null,
  })));

  protected readonly lignes = computed<Ligne[]>(() => {
    const { diff } = this.donnees();
    const choisi = this.choisi();
    let brutes = diff === '' ? [] : diff.split('\n');
    if (choisi !== null) {
      const section = sections(diff).find(s => s[0].startsWith('diff --git ') && (s[0].endsWith(` b/${choisi}`) || s[0].includes(` b/${choisi} `)));
      brutes = section ?? [];
    }
    return brutes.map(l => ({ texte: commandeVisible(l).texte, classe: classeDe(l) }));
  });
  protected readonly suspecte = computed(() => this.donnees().diff.split('\n').some(l => commandeVisible(l).suspecte)
    || this.donnees().fichiers.some(f => commandeVisible(f.fichier).suspecte));

  protected choisir(fichier: string) { this.choisi.set(this.choisi() === fichier ? null : fichier); }
}
