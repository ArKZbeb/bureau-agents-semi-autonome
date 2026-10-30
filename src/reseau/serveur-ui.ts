import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { sha256 } from '../integrite/signature.ts';
import { lireCorps, repondreJson } from './http.ts';
import { ENTETES_PANNEAU, type FichierPanneau } from './panneau.ts';

export type RoutesUi = {
  taches: () => unknown;
  journal: (tacheId: string | null) => unknown;
  integriteJournal: () => unknown;
  escalades: () => unknown;
  deciderEscalade: (id: number, decision: 'approuver' | 'refuser', commentaire: string) => unknown;
  arretGlobal: () => Promise<unknown>;
  /** Réactive l'ordonnanceur suspendu par l'arrêt global ; les tâches restent en pause. */
  repriseGlobale: () => unknown;
  etat: () => unknown;
  projets: () => unknown;
  detecterProjet: (chemin: string) => unknown;
  relierProjet: (p: { nom: string; chemin: string; budgetUsd: number; couvertureLignes: number }) => unknown;
  tache: (id: string) => unknown;
  creerTache: (t: { projet: string; titre: string; demande: string }) => Promise<unknown>;
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

async function conflit(res: http.ServerResponse, fn: () => unknown): Promise<void> {
  try {
    repondreJson(res, 200, await fn());
  } catch (e) {
    repondreJson(res, 409, { erreur: (e as Error).message });
  }
}
const texte = (v: unknown) => typeof v === 'string' && v.trim() !== '';

const egal = (a: string, b: string) => timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));

function servirPanneau(panneau: Map<string, FichierPanneau> | null, req: http.IncomingMessage, res: http.ServerResponse, chemin: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET', ...ENTETES_PANNEAU }); res.end(); return; }
  if (!panneau) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', ...ENTETES_PANNEAU });
    res.end('Panneau non construit : lancer npm run web:build, puis redémarrer le bureau.');
    return;
  }
  // Une route du front (sans extension) reçoit index.html ; un fichier absent de la carte n'existe pas.
  const f = panneau.get(chemin) ?? (path.posix.extname(chemin) === '' ? panneau.get('/index.html') : undefined);
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...ENTETES_PANNEAU }); res.end('introuvable'); return; }
  res.writeHead(200, { 'content-type': f.type, ...ENTETES_PANNEAU });
  res.end(req.method === 'HEAD' ? undefined : f.contenu);
}

export function creerServeurUi(jetonSession: string, routes: RoutesUi, panneau: Map<string, FichierPanneau> | null = null): http.Server {
  return http.createServer((req, res) => {
    traiter(jetonSession, routes, panneau, req, res).catch(e => {
      if (res.headersSent) res.end();
      else repondreJson(res, 500, { erreur: (e as Error).message });
    });
  });
}

async function traiter(jeton: string, routes: RoutesUi, panneau: Map<string, FichierPanneau> | null, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const port = req.socket.localPort;
  const hotes = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hotes.includes(req.headers.host ?? '')) return repondreJson(res, 403, { erreur: 'hôte refusé' });
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return servirPanneau(panneau, req, res, url.pathname);
  const origine = req.headers.origin;
  if (origine !== undefined && !hotes.some(h => origine === `http://${h}`)) return repondreJson(res, 403, { erreur: 'origine refusée' });
  if (!egal(req.headers.authorization ?? '', `Bearer ${jeton}`)) return repondreJson(res, 401, { erreur: 'jeton de session requis' });

  if (req.method === 'GET' && url.pathname === '/api/taches') return repondreJson(res, 200, routes.taches());
  if (req.method === 'GET' && url.pathname === '/api/journal/integrite') return repondreJson(res, 200, routes.integriteJournal());
  if (req.method === 'GET' && url.pathname === '/api/etat') return repondreJson(res, 200, routes.etat());
  if (req.method === 'GET' && url.pathname === '/api/projets') return repondreJson(res, 200, routes.projets());
  if (req.method === 'POST' && url.pathname === '/api/projets/detection') {
    const c = await lireObjet(req);
    if (!c || typeof c.chemin !== 'string' || !path.isAbsolute(c.chemin)) return repondreJson(res, 400, { erreur: 'attendu : chemin absolu' });
    const chemin = c.chemin;
    return conflit(res, () => routes.detecterProjet(chemin));
  }
  if (req.method === 'POST' && url.pathname === '/api/projets') {
    const c = await lireObjet(req);
    const ok = c && texte(c.nom) && typeof c.chemin === 'string' && path.isAbsolute(c.chemin)
      && typeof c.budgetUsd === 'number' && Number.isFinite(c.budgetUsd) && c.budgetUsd > 0
      && Number.isInteger(c.couvertureLignes) && (c.couvertureLignes as number) >= 0 && (c.couvertureLignes as number) <= 100;
    if (!c || !ok) return repondreJson(res, 400, { erreur: 'attendu : nom, chemin absolu, budgetUsd > 0, couvertureLignes entier de 0 à 100' });
    const { nom, chemin, budgetUsd, couvertureLignes } = c as Parameters<RoutesUi['relierProjet']>[0];
    return conflit(res, () => routes.relierProjet({ nom, chemin, budgetUsd, couvertureLignes }));
  }
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
    if (!c || !['projet', 'titre', 'demande'].every(k => texte(c[k]))) return repondreJson(res, 400, { erreur: 'attendu : projet, titre, demande' });
    // Objet explicite : chemin, budget et identifiant viennent de l'orchestrateur, jamais du corps.
    const { projet, titre, demande } = c as Parameters<RoutesUi['creerTache']>[0];
    return conflit(res, () => routes.creerTache({ projet, titre, demande }));
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
