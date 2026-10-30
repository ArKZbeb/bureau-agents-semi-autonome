import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiService, ErreurApi, JETON } from './api';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: JETON, useValue: 'jeton-test' }] });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  it('envoie le jeton dans l’en-tête Authorization', async () => {
    const p = api.taches();
    const req = http.expectOne('/api/taches');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-test');
    req.flush([]);
    expect(await p).toEqual([]);
  });

  it('crée une tâche avec projet, titre et demande seulement', async () => {
    const p = api.creerTache({ projet: 'Film', titre: 'Export', demande: 'Exporter' });
    const req = http.expectOne('/api/taches');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ projet: 'Film', titre: 'Export', demande: 'Exporter' });
    req.flush({ id: 'T-42' });
    await p;
  });

  it('remonte le message d’erreur du serveur', async () => {
    const p = api.action('T-41', 'reprise', {});
    http.expectOne('/api/taches/T-41/reprise').flush({ erreur: 'T-41 ne se reprend pas ainsi' }, { status: 409, statusText: 'Conflict' });
    await expect(p).rejects.toThrow('T-41 ne se reprend pas ainsi');
  });

  it('erreur : le statut HTTP accompagne le message (401 = jeton refusé)', async () => {
    const p = api.taches();
    http.expectOne('/api/taches').flush({ erreur: 'jeton de session requis' }, { status: 401, statusText: 'Unauthorized' });
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurApi);
    expect((e as ErreurApi).statut).toBe(401);
    expect((e as ErreurApi).message).toBe('jeton de session requis');
  });
});
