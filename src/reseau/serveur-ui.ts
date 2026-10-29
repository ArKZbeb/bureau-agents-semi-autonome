import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { sha256 } from '../integrite/signature.ts';
import { lireCorps, repondreJson } from './http.ts';

export type RoutesUi = {
  taches: () => unknown;
  journal: (tacheId: string | null) => unknown;
  escalades: () => unknown;
  deciderEscalade: (id: number, decision: 'approuver' | 'refuser', commentaire: string) => unknown;
  arretGlobal: () => Promise<unknown>;
};

const egal = (a: string, b: string) => timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));

export function creerServeurUi(jetonSession: string, routes: RoutesUi): http.Server {
  return http.createServer((req, res) => {
    traiter(jetonSession, routes, req, res).catch(e => {
      if (res.headersSent) res.end();
      else repondreJson(res, 500, { erreur: (e as Error).message });
    });
  });
}

async function traiter(jeton: string, routes: RoutesUi, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const port = req.socket.localPort;
  const hotes = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hotes.includes(req.headers.host ?? '')) return repondreJson(res, 403, { erreur: 'hôte refusé' });
  const origine = req.headers.origin;
  if (origine !== undefined && !hotes.some(h => origine === `http://${h}`)) return repondreJson(res, 403, { erreur: 'origine refusée' });
  if (!egal(req.headers.authorization ?? '', `Bearer ${jeton}`)) return repondreJson(res, 401, { erreur: 'jeton de session requis' });

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/taches') return repondreJson(res, 200, routes.taches());
  if (req.method === 'GET' && url.pathname === '/api/journal') return repondreJson(res, 200, routes.journal(url.searchParams.get('tache')));
  if (req.method === 'GET' && url.pathname === '/api/escalades') return repondreJson(res, 200, routes.escalades());
  const escalade = /^\/api\/escalades\/(\d+)$/.exec(url.pathname);
  if (req.method === 'POST' && escalade) {
    const brut = await lireCorps(req, 100_000);
    let corps: unknown;
    try {
      corps = JSON.parse(brut.toString('utf8') || '{}');
    } catch {
      return repondreJson(res, 400, { erreur: 'corps JSON invalide' });
    }
    if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) return repondreJson(res, 400, { erreur: 'corps JSON invalide' });
    const { decision, commentaire } = corps as { decision?: unknown; commentaire?: unknown };
    if (decision !== 'approuver' && decision !== 'refuser') return repondreJson(res, 400, { erreur: 'decision attendue : approuver ou refuser' });
    return repondreJson(res, 200, routes.deciderEscalade(Number(escalade[1]), decision, String(commentaire ?? '')));
  }
  if (req.method === 'POST' && url.pathname === '/api/arret-global') return repondreJson(res, 200, await routes.arretGlobal());
  repondreJson(res, 404, { erreur: 'introuvable' });
}
