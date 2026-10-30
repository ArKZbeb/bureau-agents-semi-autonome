import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../api';
import { LIBELLE_ETAPE, budget, eur, essai, qui } from '../libelles';
import type { EntreeJournal, FicheTache, NomAction, Tache, TypeDocument } from '../modeles';
import { RapportVue } from './rapport';

const DOCUMENTS: { type: TypeDocument; titre: string }[] = [
  { type: 'demande', titre: 'Demande' }, { type: 'spec', titre: 'spec.md' }, { type: 'criteres', titre: 'Critères' }, { type: 'plan', titre: 'plan.md' },
  { type: 'avis_patron', titre: 'Avis du patron' }, { type: 'resume', titre: "Résumé de l'implémenteur" }, { type: 'avis_patron_code', titre: 'Avis du patron sur le code' },
];
const raisonDe = (t: Tache) => (t.raison ?? '').split(' : ')[0];
const heure = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Bloc = 'questions' | 'proposition' | 'arbitrage' | 'budget' | 'reprise' | 'escalade' | 'validation' | null;

@Component({
  selector: 'app-tache',
  imports: [RouterLink, RapportVue],
  template: `
    @if (fiche(); as f) {
      <section class="ecran">
        <p class="doux mono">{{ f.tache.id }} · {{ f.tache.projet }}</p>
        <h1>{{ f.tache.titre }}</h1>
        <p class="doux">{{ etape(f.tache) }} · {{ qui(f.tache) }} @if (essai(f.tache)) { · {{ essai(f.tache) }} } · {{ budget(f.tache) }}</p>
        @if (erreur() ?? erreurChargement(); as e) { <p class="alerte">{{ e }}</p> }
        @if (f.anomalie; as a) {
          <p class="alerte anomalie">Anomalie d'intégrité : {{ a }}</p>
        } @else {
          @switch (bloc()) {
            @case ('questions') {
              <div class="bloc">
                <h2>Le cadreur attend ta réponse</h2>
                @if (questions(); as q) { <pre>{{ q }}</pre> }
                <textarea rows="5" aria-label="Ta réponse" [value]="reponse()" (input)="reponse.set($any($event.target).value)"></textarea>
                <button class="principal" [disabled]="envoi() || !reponse().trim()" (click)="envoyerReponse()">Envoyer</button>
              </div>
            }
            @case ('proposition') {
              <div class="bloc">
                <h2>Spec et plan à valider</h2>
                @if (f.proposition; as p) {
                  <h3>spec.md · rendu</h3>
                  <pre>{{ p.spec }}</pre>
                  <h3>Critères d'acceptation</h3>
                  <ol class="criteres">@for (c of p.criteres; track $index) { <li><span class="mono">C{{ $index + 1 }}</span> {{ c }}</li> }</ol>
                  <h3>plan.md · rendu</h3>
                  <pre>{{ p.plan }}</pre>
                }
                <button class="principal" [disabled]="envoi()" (click)="agir('validation-cadrage', {})">Valider la spec et le plan</button>
              </div>
            }
            @case ('arbitrage') {
              <div class="bloc">
                <h2>Arbitrage du plan</h2>
                @if (f.documents?.avis_patron; as n) { <pre>{{ n }}</pre> }
                <button [disabled]="envoi()" (click)="agir('arbitrage', { choix: 'cadreur' })">Garder l'approche du cadreur</button>
                <button class="principal" [disabled]="envoi()" (click)="agir('arbitrage', { choix: 'alternative' })">Adopter l'alternative</button>
              </div>
            }
            @case ('budget') {
              <div class="bloc">
                <h2>Budget de la tâche dépassé</h2>
                <p>{{ eur(f.tache.depenseUsd) }} consommés sur un plafond de {{ eur(f.tache.budgetUsd) }}</p>
                <button class="principal" [disabled]="envoi()" (click)="agir('budget', { montantUsd: 2 })">Continuer (+ 2,00 $)</button>
              </div>
            }
            @case ('reprise') {
              <div class="bloc">
                <p>{{ f.tache.raison }}</p>
                <button class="principal" [disabled]="envoi()" (click)="agir('reprise', {})">Reprendre</button>
              </div>
            }
            @case ('escalade') {
              <div class="bloc">
                <p>En attente de ta décision au poste de sécurité</p>
                <a routerLink="/securite">Ouvrir le poste de sécurité</a>
              </div>
            }
            @case ('validation') {
              <div class="bloc"><p>Prête pour ta validation : la boîte de validation arrive en phase 3.</p></div>
            }
          }
          <nav class="onglets">
            <button [class.actif]="onglet() === 'documents'" (click)="onglet.set('documents')">Documents</button>
            <button [class.actif]="onglet() === 'rapport'" (click)="onglet.set('rapport')">Rapport</button>
            <button [class.actif]="onglet() === 'activite'" (click)="onglet.set('activite')">Activité</button>
          </nav>
          @switch (onglet()) {
            @case ('documents') {
              @for (d of documents(); track d.type) { <h3>{{ d.titre }}</h3><pre>{{ d.texte }}</pre> }
            }
            @case ('rapport') {
              <app-rapport [donnees]="{ analyse: f.documents?.analyse ?? null, verdict: f.documents?.verdict ?? null, rapport: f.documents?.rapport ?? null }" />
            }
            @case ('activite') {
              <ul class="activite">
                @for (e of journalTrie(); track e.id) {
                  <li><span class="mono">{{ heure(e.horodatage) }}</span> <span class="mono">{{ e.commande }}</span> · {{ e.decision }} · {{ e.decideur }} · {{ e.raison }}</li>
                }
              </ul>
            }
          }
        }
      </section>
    } @else {
      <section class="ecran">
        @if (erreurChargement(); as e) { <p class="alerte">{{ e }}</p> } @else { <p class="doux">Chargement…</p> }
      </section>
    }`,
  styles: `
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--panneau); border: 1px solid var(--ligne); border-radius: 6px; padding: 8px; }
    .bloc { background: var(--panneau); border: 1px solid var(--ligne); border-radius: 8px; padding: 12px; margin: 12px 0; }
    .onglets { display: flex; gap: 8px; margin: 12px 0; }
    .onglets .actif { font-weight: bold; }
    .activite { list-style: none; padding: 0; }
  `,
})
export class TacheVue implements OnDestroy {
  readonly id = input.required<string>();
  private readonly api = inject(ApiService);
  protected readonly fiche = signal<FicheTache | null>(null);
  protected readonly journal = signal<EntreeJournal[]>([]);
  protected readonly erreur = signal<string | null>(null);
  protected readonly envoi = signal(false);
  protected readonly reponse = signal('');
  protected readonly onglet = signal<'documents' | 'rapport' | 'activite'>('documents');
  private minuteur: ReturnType<typeof setInterval> | undefined;
  private enCours = false;
  private relance = false;
  protected readonly erreurChargement = signal<string | null>(null);

  protected readonly qui = qui; protected readonly essai = essai; protected readonly budget = budget; protected readonly eur = eur; protected readonly heure = heure;
  protected etape(t: Tache) { return LIBELLE_ETAPE[t.etape]; }

  protected readonly bloc = computed<Bloc>(() => {
    const f = this.fiche();
    if (!f || f.anomalie !== undefined) return null;
    const t = f.tache;
    const raison = raisonDe(t);
    if (t.statut === 'attente_humain') {
      if (t.etape === 'cadrage' && t.raison === 'le cadreur attend ta réponse') return 'questions';
      if (t.etape === 'cadrage' && t.raison === 'spec et plan à valider') return 'proposition';
      if (t.etape === 'patron_plan') return 'arbitrage';
      if (t.etape === 'validation') return 'validation';
    }
    if (t.statut === 'en_pause') {
      if (raison === 'budget') return 'budget';
      if (raison === 'escalade') return 'escalade';
      if (raison === 'integrite' || raison === 'arret_global' || raison === 'erreur_api') return 'reprise';
    }
    if (t.statut === 'bloquee') return 'reprise';
    return null;
  });
  protected readonly questions = computed(() => [...(this.fiche()?.echanges ?? [])].reverse().find(e => e.auteur === 'cadreur')?.texte ?? null);
  protected readonly documents = computed(() => {
    const d = this.fiche()?.documents;
    return d ? DOCUMENTS.flatMap(x => (d[x.type] ? [{ type: x.type, titre: x.titre, texte: d[x.type] as string }] : [])) : [];
  });
  protected readonly journalTrie = computed(() => [...this.journal()].sort((a, b) => b.id - a.id));

  constructor() {
    effect(() => { this.id(); void this.charger(); });
    this.minuteur = setInterval(() => void this.charger(), 3000);
  }
  ngOnDestroy() { clearInterval(this.minuteur); this.minuteur = undefined; }

  private async charger(): Promise<void> {
    if (this.enCours) { this.relance = true; return; }
    this.enCours = true;
    const id = this.id();
    try {
      const [fiche, journal] = await Promise.all([this.api.tache(id), this.api.journal(id)]);
      if (id === this.id()) { this.fiche.set(fiche); this.journal.set(journal); this.erreurChargement.set(null); }
    } catch (e) {
      this.erreurChargement.set((e as Error).message);
    } finally {
      this.enCours = false;
    }
    if (this.relance) { this.relance = false; await this.charger(); }
  }

  protected async agir(nom: NomAction, corps: Record<string, unknown>) {
    this.envoi.set(true);
    this.erreur.set(null);
    try {
      await this.api.action(this.id(), nom, corps);
    } catch (e) {
      this.erreur.set((e as Error).message);
    } finally {
      this.envoi.set(false);
    }
    await this.charger();
  }
  protected async envoyerReponse() {
    await this.agir('reponse', { texte: this.reponse().trim() });
    if (this.erreur() === null) this.reponse.set('');
  }
}
