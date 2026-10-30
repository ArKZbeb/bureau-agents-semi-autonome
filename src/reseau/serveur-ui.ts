import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { sha256 } from '../integrite/signature.ts';
import { lireCorps, repondreJson } from './http.ts';

export type RoutesUi = {
  taches: () => unknown;
  journal: (tacheId: string | null) => unknown;
  escalades: () => unknown;
  deciderEscalade: (id: number, decision: 'approuver' | 'refuser', commentaire: string) => unknown;
  arretGlobal: () => Promise<unknown>;
  /** Réactive l'ordonnanceur suspendu par l'arrêt global ; les tâches restent en pause. */
  repriseGlobale: () => unknown;
  tache: (id: string) => unknown;
  creerTache: (t: { projet: string; titre: string; cheminProjet: string; budgetUsd: number; demande: string }) => Promise<unknown>;
  action: (id: string, nom: NomAction, corps: Record<string, unknown>) => unknown;
};

export type NomAction = 'reponse' | 'validation-cadrage' | 'arbitrage' | 'budget' | 'reprise';
const ACTIONS = new Set<string>(['reponse', 'validation-cadrage', 'arbitrage', 'budget', 'reprise']);

async function lireObjet(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const corps = JSON.parse((await lireCorps(req, 100_000)).toString('utf8') || '{}');
    return typeof corps === 'object' && corps !== null && !Array.isArray(corps) ? (corps as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

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
    const corps = await lireObjet(req);
    if (!corps) return repondreJson(res, 400, { erreur: 'corps JSON invalide' });
    const { decision, commentaire } = corps as { decision?: unknown; commentaire?: unknown };
    if (decision !== 'approuver' && decision !== 'refuser') return repondreJson(res, 400, { erreur: 'decision attendue : approuver ou refuser' });
    return repondreJson(res, 200, routes.deciderEscalade(Number(escalade[1]), decision, String(commentaire ?? '')));
  }
  if (req.method === 'POST' && url.pathname === '/api/taches') {
    const c = await lireObjet(req);
    const ok = c && ['projet', 'titre', 'cheminProjet', 'demande'].every(k => typeof c[k] === 'string' && (c[k] as string).trim() !== '')
      && typeof c.budgetUsd === 'number' && c.budgetUsd > 0 && path.isAbsolute(c.cheminProjet as string);
    if (!c || !ok) return repondreJson(res, 400, { erreur: 'attendu : projet, titre, demande, cheminProjet absolu, budgetUsd > 0' });
    // Objet explicite : l'identifiant est toujours attribué par l'orchestrateur, jamais par le corps.
    const { projet, titre, cheminProjet, budgetUsd, demande } = c as Parameters<RoutesUi['creerTache']>[0];
    return repondreJson(res, 200, await routes.creerTache({ projet, titre, cheminProjet, budgetUsd, demande }));
  }
  const fiche = /^\/api\/taches\/(T-\d+)$/.exec(url.pathname);
  if (req.method === 'GET' && fiche) {
    const t = routes.tache(fiche[1]);
    return t ? repondreJson(res, 200, t) : repondreJson(res, 404, { erreur: 'tâche introuvable' });
  }
  const action = /^\/api\/taches\/(T-\d+)\/([a-z-]+)$/.exec(url.pathname);
  if (req.method === 'POST' && action && ACTIONS.has(action[2])) {
    const c = await lireObjet(req);
    if (!c) return repondreJson(res, 400, { erreur: 'corps JSON invalide' });
    try {
      return repondreJson(res, 200, routes.action(action[1], action[2] as NomAction, c));
    } catch (e) {
      return repondreJson(res, 409, { erreur: (e as Error).message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/arret-global') return repondreJson(res, 200, await routes.arretGlobal());
  if (req.method === 'POST' && url.pathname === '/api/reprise-globale') return repondreJson(res, 200, routes.repriseGlobale());
  repondreJson(res, 404, { erreur: 'introuvable' });
}
