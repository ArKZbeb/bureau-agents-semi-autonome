import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { EntreeHook, SortieHook } from '../gardien/service.ts';
import { lireCorps, repondreJson } from './http.ts';
import type { Jetons } from './jetons.ts';

export type DepsServeurConteneurs = {
  jetons: Jetons;
  gardien: (tacheId: string, e: EntreeHook) => Promise<SortieHook>;
  api: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
  domaines: string[];
  ports: number[];
  journaliserRefus: (tacheId: string | null, cible: string) => void;
};

export function creerServeurConteneurs(deps: DepsServeurConteneurs): http.Server {
  const serveur = http.createServer((req, res) => {
    traiter(deps, req, res).catch(e => {
      // Une erreur du gardien fait échouer le hook, qui bloque l'appel (exit 2).
      if (!res.headersSent) repondreJson(res, 500, { erreur: (e as Error).message });
      else res.end();
    });
  });
  serveur.on('connect', (req: http.IncomingMessage, socket: Duplex, tete: Buffer) => tunnel(deps, req, socket, tete));
  return serveur;
}

async function traiter(deps: DepsServeurConteneurs, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '';
  if (/^[a-z]+:\/\//i.test(url)) {
    deps.journaliserRefus(null, url);
    return repondreJson(res, 403, { erreur: 'proxy HTTP en clair interdit' });
  }
  if (req.method === 'POST' && url === '/gardien') {
    const tacheId = deps.jetons.valider(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!tacheId) return repondreJson(res, 401, { erreur: 'jeton de tâche invalide' });
    const entree = JSON.parse((await lireCorps(req, 2_000_000)).toString('utf8')) as EntreeHook;
    return repondreJson(res, 200, await deps.gardien(tacheId, entree));
  }
  if (url.startsWith('/v1/')) return deps.api(req, res);
  repondreJson(res, 404, { erreur: 'introuvable' });
}

function tunnel(deps: DepsServeurConteneurs, req: http.IncomingMessage, socket: Duplex, tete: Buffer): void {
  socket.on('error', () => socket.destroy());
  const auth = req.headers['proxy-authorization'];
  const jeton = typeof auth === 'string' && auth.startsWith('Basic ')
    ? Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':')
    : undefined;
  const tacheId = deps.jetons.valider(jeton);
  if (!tacheId) {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="bureau"\r\n\r\n');
    return;
  }
  const cible = req.url ?? '';
  const separateur = cible.lastIndexOf(':');
  const hote = cible.slice(0, separateur).toLowerCase();
  const port = Number(cible.slice(separateur + 1));
  if (!deps.domaines.includes(hote) || !deps.ports.includes(port)) {
    deps.journaliserRefus(tacheId, cible);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const amont = net.connect(port, hote, () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (tete.length) amont.write(tete);
    amont.pipe(socket);
    socket.pipe(amont);
  });
  amont.on('error', () => socket.destroy());
  socket.on('close', () => amont.destroy());
}
