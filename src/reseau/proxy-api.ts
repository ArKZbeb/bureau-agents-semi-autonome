import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Tarifs } from '../config.ts';
import { coutUsd, type Usage } from '../cout.ts';
import type { Base } from '../db.ts';
import { ajouterDepense, lireTache } from '../taches/depot.ts';
import { lireCorps, repondreJson } from './http.ts';
import type { Jetons } from './jetons.ts';

export type DepsProxyApi = {
  db: Base; jetons: Jetons; urlAmont: string; cleApi: string | undefined; tarifs: Tarifs;
  surBudgetDepasse: (tacheId: string) => void;
};

const ENTETES_TRANSMIS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta'];
const ENTETES_RETOUR = ['content-type', 'request-id', 'retry-after', 'x-should-retry'];

const erreurApi = (res: ServerResponse, statut: number, type: string, message: string) =>
  repondreJson(res, statut, { type: 'error', error: { type, message } });

/** Lit l'usage au fil du flux SSE (message_start, message_delta) ou dans la réponse JSON. */
function compteurUsage(sse: boolean) {
  const decodeur = new TextDecoder();
  let tampon = '';
  let usage: Usage | null = null;
  let modele: string | null = null;
  const traiter = (m: any) => {
    if (m?.type === 'message_start') { modele = m.message?.model ?? null; usage = { ...m.message?.usage }; }
    if (m?.type === 'message_delta' && m.usage) usage = { ...usage, ...m.usage };
    if (m?.type === 'message') { modele = m.model ?? null; usage = m.usage ?? null; }
  };
  const lignes = (fin: boolean) => {
    const parts = tampon.split('\n');
    tampon = fin ? '' : parts.pop() ?? '';
    for (const l of parts) if (l.startsWith('data:')) { try { traiter(JSON.parse(l.slice(5))); } catch { /* ligne partielle ou ping */ } }
  };
  return {
    ajouter(morceau: Uint8Array) { tampon += decodeur.decode(morceau, { stream: true }); if (sse) lignes(false); },
    terminer(): { usage: Usage | null; modele: string | null } {
      tampon += decodeur.decode();
      if (sse) lignes(true);
      else try { traiter(JSON.parse(tampon)); } catch { /* corps non JSON : pas d'usage */ }
      return { usage, modele };
    },
  };
}

// Seuls ces points d'accès sont relayés ; le reste (lots, fichiers…) n'atteint jamais l'amont.
const POINTS_AUTORISES = new Set(['/v1/messages', '/v1/messages/count_tokens']);

export async function relayerApi(deps: DepsProxyApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const jeton = (req.headers['x-api-key'] as string | undefined) ?? req.headers.authorization?.replace(/^Bearer /, '');
  const tacheId = deps.jetons.valider(jeton);
  if (!tacheId) return erreurApi(res, 401, 'authentication_error', 'jeton de tâche invalide ou expiré');
  const chemin = new URL(req.url ?? '/', 'http://proxy.local').pathname;
  if (req.method !== 'POST' || !POINTS_AUTORISES.has(chemin)) return erreurApi(res, 404, 'not_found_error', 'point d’accès non autorisé');

  const tache = lireTache(deps.db, tacheId);
  if (tache.depenseUsd >= tache.budgetUsd) {
    deps.surBudgetDepasse(tacheId);
    return erreurApi(res, 403, 'permission_error', 'Budget de la tâche dépassé');
  }
  if (!deps.cleApi) return erreurApi(res, 503, 'api_error', 'clé API absente côté orchestrateur');

  const corps = await lireCorps(req, 50_000_000);
  const entetes: Record<string, string> = { 'x-api-key': deps.cleApi, 'accept-encoding': 'identity' };
  for (const n of ENTETES_TRANSMIS) { const v = req.headers[n]; if (typeof v === 'string') entetes[n] = v; }

  const cibleAmont = new URL(req.url ?? '/', deps.urlAmont);
  if (cibleAmont.origin !== new URL(deps.urlAmont).origin) return erreurApi(res, 502, 'api_error', 'cible amont refusée');

  let amont: Response;
  try {
    amont = await fetch(cibleAmont, {
      method: req.method, headers: entetes, redirect: 'manual', body: new Uint8Array(corps),
    });
  } catch (e) {
    return erreurApi(res, 502, 'api_error', `API injoignable : ${(e as Error).message}`);
  }
  if (amont.status >= 300 && amont.status < 400) {
    await amont.body?.cancel();
    return erreurApi(res, 502, 'api_error', 'redirection amont refusée');
  }

  const retour: Record<string, string> = {};
  for (const n of ENTETES_RETOUR) { const v = amont.headers.get(n); if (v) retour[n] = v; }
  res.writeHead(amont.status, retour);
  const compteur = compteurUsage((amont.headers.get('content-type') ?? '').includes('event-stream'));
  let interrompu = false;
  try {
    if (amont.body) for await (const morceau of amont.body) { res.write(morceau); compteur.ajouter(morceau); }
  } catch {
    interrompu = true;
  } finally {
    // Flux amont coupé : la connexion client est fermée sans fin propre, pour qu'un flux tronqué ne paraisse pas complet.
    if (interrompu) res.destroy(); else res.end();
    facturer(deps, tacheId, compteur, amont, chemin);
  }
}

/** Facture l'usage lu, même sur flux interrompu. Un échec de facturation est journalisé et signalé à l'orchestrateur. */
function facturer(deps: DepsProxyApi, tacheId: string, compteur: ReturnType<typeof compteurUsage>, amont: Response, chemin: string): void {
  try {
    const { usage, modele } = compteur.terminer();
    if (usage && amont.ok && chemin !== '/v1/messages/count_tokens') {
      const t = ajouterDepense(deps.db, tacheId, coutUsd(usage, modele ?? '', deps.tarifs));
      if (t.depenseUsd >= t.budgetUsd) deps.surBudgetDepasse(tacheId);
    }
  } catch (e) {
    console.error(`facturation impossible pour ${tacheId} : ${(e as Error).message}`);
    try { deps.surBudgetDepasse(tacheId); } catch { /* signalement impossible : le journal console reste */ }
  }
}
