import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ApiService } from '../api';
import { commandeVisible } from '../commande-visible';
import { heure } from '../libelles';
import type { DossierValidation, EntreeJournal, FicheTache } from '../modeles';
import { DiffVue } from './diff';
import { RapportVue } from './rapport';

type Onglet = 'diff' | 'rapports' | 'avis' | 'journal';

@Component({
  selector: 'app-validation',
  imports: [DiffVue, RapportVue],
  template: `
    <div class="bloc">
      @if (erreurChargement(); as e) { <p class="alerte">{{ e }} <button (click)="recharger()">Recharger</button></p> }
      @if (dossier(); as d) {
        <p class="doux mono">{{ fiche().tache.id }} · {{ fiche().tache.projet }}</p>
        <h2>{{ fiche().tache.titre }}</h2>
        <p class="mono">{{ commande(d.branche) }} · {{ d.commits }} commits · +{{ ajouts() }} −{{ suppressions() }}</p>
        @if (raisonIntegrite(); as r) { <p class="nogo">✕ Intégrité non vérifiée : {{ r }}</p> } @else { <p class="go">✓ Intégrité vérifiée</p> }
        @if (verdictQa(); as v) { <p [class]="v === 'go' ? 'go' : 'nogo'">Verdict QA : {{ v === 'go' ? 'GO' : 'NO-GO' }}</p> }
        <nav class="onglets">
          <button [class.actif]="onglet() === 'diff'" (click)="onglet.set('diff')">Diff</button>
          <button [class.actif]="onglet() === 'rapports'" (click)="onglet.set('rapports')">Rapports</button>
          <button [class.actif]="onglet() === 'avis'" (click)="onglet.set('avis')">Avis du patron</button>
          <button [class.actif]="onglet() === 'journal'" (click)="onglet.set('journal')">Journal</button>
        </nav>
        @switch (onglet()) {
          @case ('diff') { <app-diff [donnees]="{ diff: d.diff, fichiers: d.fichiers, tronque: d.tronque }" /> }
          @case ('rapports') {
            <app-rapport [donnees]="{ analyse: fiche().documents?.analyse ?? null, verdict: fiche().documents?.verdict ?? null, rapport: fiche().documents?.rapport ?? null }" />
          }
          @case ('avis') {
            <h3>Note critique non bloquante · Patron · d'après le diff et les rapports</h3>
            <pre>{{ fiche().documents?.avis_patron_code ?? '' }}</pre>
          }
          @case ('journal') {
            <p>{{ d.journal.commandes }} commandes · {{ d.journal.refus }} refus · {{ d.journal.escalades }} escalade(s)</p>
            <ul class="activite">
              @for (e of journalTrie(); track e.id) {
                <li><span class="mono">{{ heure(e.horodatage) }}</span> <span class="mono">{{ commande(e.commande) }}</span> · {{ e.decision }} · {{ e.decideur }} · {{ e.raison }}</li>
              }
            </ul>
          }
        }
        @if (message(); as m) { <p class="go">{{ m }}</p> }
        @if (erreur(); as e) { <p class="alerte">{{ e }}</p> }
        <div class="actions">
          <button [disabled]="envoi()" (click)="recuperer()">Récupérer la branche</button>
          <button class="principal" [disabled]="envoi() || !!raisonIntegrite()" (click)="ouvrirPr()">Ouvrir une PR</button>
          <button [disabled]="envoi()" (click)="dialogue.set('renvoi')">Renvoyer avec commentaire</button>
          <button class="danger" [disabled]="envoi()" (click)="dialogue.set('abandon')">Abandonner</button>
          <button [disabled]="envoi()" (click)="recharger()">Recharger</button>
        </div>
      } @else if (!erreurChargement()) { <p class="doux">Chargement…</p> }
      @if (dialogue() === 'renvoi') {
        <div class="voile"><section class="dialogue">
          <h2>Renvoyer avec commentaire</h2>
          <textarea rows="5" aria-label="Commentaire" [value]="commentaire()" (input)="commentaire.set($any($event.target).value)"></textarea>
          <footer>
            <button (click)="dialogue.set(null)">Annuler</button>
            <button class="principal" [disabled]="envoi() || !commentaire().trim()" (click)="renvoyer()">Renvoyer</button>
          </footer>
        </section></div>
      }
      @if (dialogue() === 'abandon') {
        <div class="voile"><section class="dialogue">
          <h2>Abandonner {{ fiche().tache.id }} ?</h2>
          <p>Abandonner {{ fiche().tache.id }} ? La branche n'est pas récupérée et l'espace de la tâche est supprimé.</p>
          <footer>
            <button (click)="dialogue.set(null)">Annuler</button>
            <button class="danger" [disabled]="envoi()" (click)="abandonner()">Abandonner</button>
          </footer>
        </section></div>
      }
    </div>`,
  styles: `
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--panneau); border: 1px solid var(--ligne); border-radius: 6px; padding: 8px; }
    .bloc { background: var(--panneau); border: 1px solid var(--ligne); border-radius: 8px; padding: 12px; margin: 12px 0; }
    .onglets { display: flex; gap: 8px; margin: 12px 0; }
    .onglets .actif { font-weight: bold; }
    .activite { list-style: none; padding: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    p { overflow-wrap: anywhere; }
  `,
})
export class ValidationVue {
  readonly id = input.required<string>();
  /** Fiche et journal de la tâche, déjà relus par `TacheVue` : ce composant ne les interroge pas. */
  readonly fiche = input.required<FicheTache>();
  readonly journal = input<EntreeJournal[]>([]);
  /** Message de succès, pour que la vue parente le garde quand la tâche quitte l'étape. */
  readonly fait = output<string>();

  private readonly api = inject(ApiService);
  protected readonly dossier = signal<DossierValidation | null>(null);
  protected readonly erreurChargement = signal<string | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly envoi = signal(false);
  protected readonly onglet = signal<Onglet>('diff');
  protected readonly dialogue = signal<'renvoi' | 'abandon' | null>(null);
  protected readonly commentaire = signal('');
  protected readonly heure = heure;
  private chargement = 0;

  protected readonly ajouts = computed(() => (this.dossier()?.fichiers ?? []).reduce((s, f) => s + (f.ajouts ?? 0), 0));
  protected readonly suppressions = computed(() => (this.dossier()?.fichiers ?? []).reduce((s, f) => s + (f.suppressions ?? 0), 0));
  protected readonly raisonIntegrite = computed(() => {
    const i = this.dossier()?.integrite;
    return i && !i.verifiee ? i.raison || 'raison inconnue' : null;
  });
  protected readonly verdictQa = computed<'go' | 'no_go' | null>(() => {
    const t = this.fiche().documents?.verdict;
    if (!t) return null;
    try {
      const v = (JSON.parse(t) as { verdict?: unknown }).verdict;
      return v === 'go' || v === 'no_go' ? v : null;
    } catch { return null; }
  });
  protected readonly journalTrie = computed(() => [...this.journal()].sort((a, b) => b.id - a.id));

  constructor() {
    // Une seule lecture par tâche (chaque appel peut ajouter une entrée « Refusé » au journal) ; ensuite « Recharger » seulement.
    effect(() => {
      this.id();
      untracked(() => void this.recharger());
    });
  }

  protected commande(t: string) { return commandeVisible(t).texte; }

  protected async recharger() {
    const n = ++this.chargement;
    const id = this.id();
    this.erreurChargement.set(null);
    try {
      const d = await this.api.validation(id);
      if (n === this.chargement) this.dossier.set(d);
    } catch (e) {
      if (n === this.chargement) { this.dossier.set(null); this.erreurChargement.set((e as Error).message); }
    }
  }

  private async agir(appel: () => Promise<string>) {
    if (this.envoi()) return;
    this.envoi.set(true);
    this.erreur.set(null);
    this.message.set(null);
    try {
      const m = await appel();
      this.message.set(m);
      this.fait.emit(m);
    } catch (e) {
      this.erreur.set((e as Error).message);
    } finally {
      this.envoi.set(false);
    }
  }

  protected recuperer() {
    return this.agir(async () => {
      await this.api.action(this.id(), 'recuperation', {});
      return `Branche ${this.dossier()?.branche ?? ''} récupérée dans ton dépôt.`;
    });
  }
  protected ouvrirPr() {
    return this.agir(async () => `PR ouverte : ${(await this.api.action(this.id(), 'pr', {})).url}`);
  }
  protected renvoyer() {
    const commentaire = this.commentaire().trim();
    if (!commentaire) return Promise.resolve();
    this.dialogue.set(null);
    return this.agir(async () => {
      await this.api.action(this.id(), 'renvoi', { commentaire });
      this.commentaire.set('');
      return "Tâche renvoyée à l'implémenteur.";
    });
  }
  protected abandonner() {
    this.dialogue.set(null);
    return this.agir(async () => {
      await this.api.action(this.id(), 'abandon', {});
      return 'Tâche abandonnée.';
    });
  }
}
