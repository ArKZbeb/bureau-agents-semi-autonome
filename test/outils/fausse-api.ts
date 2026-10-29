import http, { type IncomingHttpHeaders } from 'node:http';

export type Tour = { outil?: { nom: string; entree: Record<string, unknown> }; texte?: string; delaiMs?: number };
export type Requete = { chemin: string; cleApi: string | undefined; corps: any; entetes: IncomingHttpHeaders };
export type FausseApi = { url: string; requetes: Requete[]; fermer: () => Promise<void> };

const USAGE = { input_tokens: 100, output_tokens: 50 };

/** Fausse API Messages : rejoue un scénario d'outils sans aucun appel réel. */
export async function demarrerFausseApi(tours: Tour[]): Promise<FausseApi> {
  const requetes: Requete[] = [];
  let index = 0;
  let n = 0;
  const serveur = http.createServer(async (req, res) => {
    let brut = '';
    for await (const m of req) brut += m;
    const corps = brut ? JSON.parse(brut) : {};
    requetes.push({ chemin: req.url ?? '', cleApi: req.headers['x-api-key'] as string | undefined, corps, entetes: req.headers });
    if (req.url?.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    const tour: Tour = corps.tools?.length ? tours[index++] ?? { texte: 'FIN' } : { texte: 'APPEL ANNEXE' };
    if (tour.delaiMs) await new Promise(r => setTimeout(r, tour.delaiMs));
    n++;
    const bloc = tour.outil
      ? { type: 'tool_use', id: `toolu_faux_${n}`, name: tour.outil.nom, input: tour.outil.entree }
      : { type: 'text', text: tour.texte ?? 'FIN' };
    const stop = tour.outil ? 'tool_use' : 'end_turn';
    const message = { id: `msg_faux_${n}`, type: 'message', role: 'assistant', model: corps.model, content: [] as unknown[], stop_reason: null, stop_sequence: null, usage: USAGE };
    if (!corps.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...message, content: [bloc], stop_reason: stop }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message });
    if (bloc.type === 'tool_use') {
      ev('content_block_start', { index: 0, content_block: { ...bloc, input: {} } });
      ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(bloc.input) } });
    } else {
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: bloc.text } });
    }
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } });
    ev('message_stop', {});
    res.end();
  });
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', r));
  const { port } = serveur.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    requetes,
    fermer: () => new Promise<void>(r => { serveur.closeAllConnections(); serveur.close(() => r()); }),
  };
}
