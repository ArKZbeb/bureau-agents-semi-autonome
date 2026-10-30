import { Component, computed, input } from '@angular/core';
import type { Analyse, StatutOutil, Verdict } from '../modeles';

const LIBELLES: Record<string, string> = {
  tests_dotnet: 'dotnet test', audit_dotnet: 'dotnet list package --vulnerable', tests_angular: 'ng test', audit_npm: 'npm audit',
  semgrep: 'Semgrep', gitleaks: 'gitleaks', couverture: 'couverture des lignes modifiées',
};
const STATUTS: Record<StatutOutil, string> = { ok: '✓', echec: '✕ échec', absent: '✕ mesure manquante', non_applicable: '— non applicable' };
const SEVERITES = ['critique', 'haute', 'moyenne', 'basse'] as const;

type Lu<T> = T | null | 'illisible';
function lire<T>(texte: string | null): Lu<T> {
  if (texte === null) return null;
  try { return JSON.parse(texte) as T; } catch { return 'illisible'; }
}
const objet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const liste = (v: unknown): v is unknown[] => Array.isArray(v);
const chaines = (v: unknown) => liste(v) && v.every(x => typeof x === 'string');
const nombre = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function analyseValide(v: unknown): v is Analyse {
  return objet(v) && objet(v['outils']) && Object.values(v['outils']).every(s => typeof s === 'string')
    && liste(v['constats']) && v['constats'].every(c => objet(c) && typeof c['severite'] === 'string' && typeof c['message'] === 'string' && (c['fichier'] === null || typeof c['fichier'] === 'string'))
    && chaines(v['signalements'])
    && (v['tests'] === null || (objet(v['tests']) && nombre(v['tests']['total']) && nombre(v['tests']['echecs'])))
    && (v['couverture'] === null || (objet(v['couverture']) && nombre(v['couverture']['couvertes']) && nombre(v['couverture']['total'])
      && (v['couverture']['pourcentage'] === null || nombre(v['couverture']['pourcentage'])) && chaines(v['couverture']['sourcesHorsCouverture'])));
}
function verdictValide(v: unknown): v is Verdict {
  return objet(v) && (v['verdict'] === 'go' || v['verdict'] === 'no_go') && chaines(v['regles']) && objet(v['qa']) && liste(v['qa']['criteres'])
    && v['qa']['criteres'].every(c => objet(c) && nombre(c['numero']) && typeof c['rempli'] === 'boolean' && typeof c['preuve'] === 'string');
}

@Component({
  selector: 'app-rapport',
  template: `
    @if (analyse() === null) {
      <h3>Rapport en construction</h3>
      <p class="doux">Analyse pas encore faite.</p>
    } @else if (analyse() === 'illisible') {
      <p class="alerte">Document illisible</p>
    } @else {
      @if (analyse(); as a) {
        @if (a !== 'illisible') {
          <h3>Analyse déterministe</h3>
          <table>
            @for (o of outils(); track o.cle) { <tr><td>{{ o.nom }}</td><td>{{ o.statut }}</td></tr> }
          </table>
          @if (a.tests; as t) { <p>Tests : {{ t.total - t.echecs }} / {{ t.total }} verts</p> } @else { <p>Tests : mesure manquante</p> }
          @if (a.couverture; as c) {
            @if (c.pourcentage !== null) {
              <p>Couverture des lignes modifiées : {{ c.pourcentage }} % ({{ c.couvertes }} / {{ c.total }})</p>
            } @else { <p>Couverture des lignes modifiées : non mesurable</p> }
            @if (c.sourcesHorsCouverture.length) {
              <p>Hors couverture :</p>
              <ul>@for (s of c.sourcesHorsCouverture; track $index) { <li class="mono">{{ s }}</li> }</ul>
            }
          } @else { <p>Couverture des lignes modifiées : non mesurable</p> }
          <h4>Failles par sévérité</h4>
          <p>@for (s of comptes(); track s.nom) { <span class="mono">{{ s.nom }} {{ s.n }} </span> }</p>
          <ul>@for (c of a.constats; track $index) { <li>{{ c.severite }} · {{ c.message }} · {{ c.fichier ?? '—' }}</li> }</ul>
          @if (a.signalements.length) {
            <h4>Signalements</h4>
            <ul>@for (s of a.signalements; track $index) { <li>{{ s }}</li> }</ul>
          } @else { <p>Signes de triche : aucun</p> }
        }
      }
    }
    @if (verdict() === 'illisible') {
      <p class="alerte">Document illisible</p>
    } @else {
      @if (verdict(); as v) {
        @if (v !== 'illisible') {
          <h3 [class.go]="v.verdict === 'go'" [class.nogo]="v.verdict === 'no_go'">Verdict QA : {{ v.verdict === 'go' ? 'GO' : 'NO-GO' }}</h3>
          @if (v.regles.length) {
            <p>Règles automatiques déclenchées :</p>
            <ul>@for (r of v.regles; track $index) { <li>{{ r }}</li> }</ul>
          } @else { <p>Règles automatiques : aucune condition de no-go déclenchée.</p> }
          <ul>@for (c of v.qa.criteres; track $index) { <li>{{ c.rempli ? '✓' : '✕' }} C{{ c.numero }} · Preuve : {{ c.preuve }}</li> }</ul>
        }
      }
    }
    @if (donnees().rapport; as r) {
      <h3>Rapport du reviewer</h3>
      <pre>{{ r }}</pre>
    }`,
  styles: `.go { color: var(--ok, green); } .nogo { color: var(--danger, crimson); } pre { white-space: pre-wrap; }`,
})
export class RapportVue {
  readonly donnees = input.required<{ analyse: string | null; verdict: string | null; rapport: string | null }>();
  protected readonly analyse = computed<Lu<Analyse>>(() => {
    const v = lire<unknown>(this.donnees().analyse);
    return v === null || v === 'illisible' ? v : analyseValide(v) ? v : 'illisible';
  });
  protected readonly verdict = computed<Lu<Verdict>>(() => {
    const v = lire<unknown>(this.donnees().verdict);
    return v === null || v === 'illisible' ? v : verdictValide(v) ? v : 'illisible';
  });
  protected readonly outils = computed(() => {
    const a = this.analyse();
    if (a === null || a === 'illisible') return [];
    return Object.entries(a.outils).map(([cle, s]) => ({ cle, nom: LIBELLES[cle] ?? cle, statut: STATUTS[s] ?? String(s) }));
  });
  protected readonly comptes = computed(() => {
    const a = this.analyse();
    if (a === null || a === 'illisible') return [];
    return SEVERITES.map(nom => ({ nom, n: a.constats.filter(c => c.severite === nom).length }));
  });
}
