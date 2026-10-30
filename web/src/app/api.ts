import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type { Detection, EntreeJournal, Escalade, EtatGlobal, FicheTache, IntegriteJournal, NomAction, Projet, Tache } from './modeles';

export const JETON = new InjectionToken<string>('jeton de session');

/** Erreur d'appel à l'orchestrateur ; `statut` vaut 0 quand il ne répond pas. */
export class ErreurApi extends Error {
  constructor(message: string, readonly statut: number) { super(message); }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly entetes = new HttpHeaders({ Authorization: `Bearer ${inject(JETON)}` });

  private async appel<T>(o: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(o);
    } catch (e) {
      if (e instanceof HttpErrorResponse) throw new ErreurApi(e.error?.erreur ?? `${e.status} ${e.statusText}`, e.status);
      throw new ErreurApi((e as Error).message, 0);
    }
  }
  private get<T>(url: string) { return this.appel(this.http.get<T>(url, { headers: this.entetes })); }
  private post<T>(url: string, corps: unknown) { return this.appel(this.http.post<T>(url, corps, { headers: this.entetes })); }

  taches() { return this.get<Tache[]>('/api/taches'); }
  tache(id: string) { return this.get<FicheTache>(`/api/taches/${encodeURIComponent(id)}`); }
  creerTache(t: { projet: string; titre: string; demande: string }) { return this.post<Tache>('/api/taches', t); }
  action(id: string, nom: NomAction, corps: Record<string, unknown>) { return this.post<Tache>(`/api/taches/${encodeURIComponent(id)}/${nom}`, corps); }
  projets() { return this.get<Projet[]>('/api/projets'); }
  detecter(chemin: string) { return this.post<Detection>('/api/projets/detection', { chemin }); }
  relier(p: { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number }) { return this.post<Projet>('/api/projets', p); }
  escalades() { return this.get<Escalade[]>('/api/escalades'); }
  deciderEscalade(id: number, decision: 'approuver' | 'refuser', commentaire: string) { return this.post<Tache>(`/api/escalades/${String(id)}`, { decision, commentaire }); }
  journal(tacheId?: string) { return this.get<EntreeJournal[]>(tacheId ? `/api/journal?tache=${encodeURIComponent(tacheId)}` : '/api/journal'); }
  integrite() { return this.get<IntegriteJournal>('/api/journal/integrite'); }
  etat() { return this.get<EtatGlobal>('/api/etat'); }
  arretGlobal() { return this.post<unknown>('/api/arret-global', {}); }
  repriseGlobale() { return this.post<unknown>('/api/reprise-globale', {}); }
}
