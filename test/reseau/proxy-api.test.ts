import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ouvrirBase, type Base } from '../../src/db.ts';
import { creerTache, lireTache } from '../../src/taches/depot.ts';
import { Jetons } from '../../src/reseau/jetons.ts';
import { relayerApi } from '../../src/reseau/proxy-api.ts';
import { TARIFS } from '../../src/config.ts';
import { demarrerFausseApi } from '../outils/fausse-api.ts';

const CLE = 'cle-reelle-de-test';

/** Proxy API seul, relié à un amont quelconque. Chaque traitement est mémorisé pour l'attendre. */
function monterSur(urlAmont: string, budgetUsd = 6, db: Base = ouvrirBase(':memory:')) {
  creerTache(db, { id: 'T-41', projet: 'Film', titre: 't', cheminProjet: '/p', budgetUsd });
  const jetons = new Jetons();
  const jeton = jetons.creer('T-41', 60_000);
  const budgets: string[] = [];
  const traitements: Promise<void>[] = [];
  const serveur = http.createServer((req, res) => {
    traitements.push(relayerApi({ db, jetons, urlAmont, cleApi: CLE, tarifs: TARIFS, surBudgetDepasse: id => budgets.push(id) }, req, res));
  });
  const prete = new Promise<void>(r => serveur.listen(0, '127.0.0.1', r));
  const url = () => `http://127.0.0.1:${(serveur.address() as { port: number }).port}`;
  const appelerChemin = async (methode: string, chemin: string, cle: string, stream = true) => {
    await prete;
    return fetch(`${url()}${chemin}`, {
      method: methode, headers: { 'x-api-key': cle, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: methode === 'POST' ? JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 10, stream, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'go' }] }) : undefined,
    });
  };
  const appeler = (cle: string, stream = true) => appelerChemin('POST', '/v1/messages?beta=true', cle, stream);
  const fermer = async () => { serveur.close(); serveur.closeAllConnections(); };
  return { db, jeton, budgets, traitements, appeler, appelerChemin, fermer, url: async () => { await prete; return url(); } };
}

async function monter(budgetUsd = 6) {
  const api = await demarrerFausseApi([{ outil: { nom: 'Bash', entree: { command: 'dotnet test' } } }]);
  const m = monterSur(api.url, budgetUsd);
  return { ...m, api, fermer: async () => { await m.fermer(); await api.fermer(); } };
}

/** Amont de test écrit à la main : chaque requête est confiée à `gestion`. */
async function amont(gestion: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const serveur = http.createServer(gestion);
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(serveur.address() as { port: number }).port}`,
    fermer: () => new Promise<void>(r => { serveur.closeAllConnections(); serveur.close(() => r()); }),
  };
}

test('flux relayé, clé réelle ajoutée par le proxy, coût imputé', async () => {
  const m = await monter();
  const r = await m.appeler(m.jeton);
  const texte = await r.text();
  assert.equal(r.status, 200);
  assert.match(texte, /event: message_stop/);
  assert.match(texte, /"partial_json":"\{\\"command\\":\\"dotnet test\\"\}"/);
  assert.equal(m.api.requetes[0].cleApi, CLE);
  assert.ok(!JSON.stringify(m.api.requetes).includes(m.jeton), 'le jeton ne sort pas vers l’amont');
  for (const req of m.api.requetes) {
    assert.equal(req.entetes.authorization, undefined, 'pas d’en-tête authorization vers l’amont');
    for (const v of Object.values(req.entetes)) assert.ok(!String(v).includes(m.jeton), 'aucun en-tête ne porte le jeton');
  }
  assert.equal(lireTache(m.db, 'T-41').depenseUsd, (100 * 2 + 50 * 10) / 1e6);
  await m.fermer();
});

test('réponse JSON non streamée comptée aussi', async () => {
  const m = await monter();
  const r = await m.appeler(m.jeton, false);
  assert.equal((await r.json()).stop_reason, 'tool_use');
  assert.equal(lireTache(m.db, 'T-41').depenseUsd, 0.0007);
  await m.fermer();
});

test('jeton invalide : 401, rien n’est relayé', async () => {
  const m = await monter();
  const r = await m.appeler('sk-ant-vole');
  assert.equal(r.status, 401);
  assert.equal(m.api.requetes.length, 0);
  await m.fermer();
});

test('budget atteint : coupure 403 et signalement', async () => {
  const m = await monter(0.0005);
  assert.equal((await m.appeler(m.jeton)).status, 200);
  assert.deepEqual(m.budgets, ['T-41'], 'le dépassement est signalé dès qu’il survient');
  const r = await m.appeler(m.jeton);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error.message, /Budget de la tâche dépassé/);
  assert.equal(m.api.requetes.length, 1);
  await m.fermer();
});

test('points d’accès hors liste : 404, rien n’atteint l’amont', async () => {
  const m = await monter();
  for (const [methode, chemin] of [['POST', '/v1/messages/batches'], ['GET', '/v1/files'], ['DELETE', '/v1/files/x']]) {
    const r = await m.appelerChemin(methode, chemin, m.jeton);
    assert.equal(r.status, 404, `${methode} ${chemin}`);
    assert.equal((await r.json()).error.type, 'not_found_error');
  }
  assert.equal(m.api.requetes.length, 0);
  await m.fermer();
});

test('count_tokens relayé comme point d’accès autorisé', async () => {
  const m = await monter();
  const r = await m.appelerChemin('POST', '/v1/messages/count_tokens?beta=true', m.jeton);
  assert.equal(r.status, 200);
  assert.equal(m.api.requetes.length, 1);
  await Promise.all(m.traitements);
  assert.equal(lireTache(m.db, 'T-41').depenseUsd, 0);
  await m.fermer();
});

test('flux interrompu : l’usage reçu avant la coupure est facturé', async () => {
  const up = await amont((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":1000,"output_tokens":1}}}\n\n');
    setTimeout(() => req.socket.destroy(), 20);
  });
  const m = monterSur(up.url);
  const r = await m.appeler(m.jeton).catch(() => null);
  let complet = true;
  if (r) {
    try { await r.text(); } catch { complet = false; }
  }
  assert.equal(complet, false, 'le flux tronqué ne paraît pas complet côté client');
  await Promise.all(m.traitements);
  assert.ok(lireTache(m.db, 'T-41').depenseUsd > 0, 'la dépense partielle est imputée');
  await m.fermer();
  await up.fermer();
});

test('échec de facturation : réponse complète et signalée à l’orchestrateur', async () => {
  const api = await demarrerFausseApi([{ outil: { nom: 'Bash', entree: { command: 'dotnet test' } } }]);
  const base = ouvrirBase(':memory:');
  const bdd = {
    prepare: (sql: string) => {
      if (sql.startsWith('UPDATE taches SET depense_usd')) throw new Error('base indisponible');
      return base.prepare(sql);
    },
  } as unknown as Base;
  const m = monterSur(api.url, 6, bdd);
  const r = await m.appeler(m.jeton);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /event: message_stop/);
  await Promise.all(m.traitements);
  assert.deepEqual(m.budgets, ['T-41'], 'l’échec de facturation est signalé');
  assert.equal(lireTache(m.db, 'T-41').depenseUsd, 0);
  await m.fermer();
  await api.fermer();
});

test('redirection amont refusée en 502, non suivie', async () => {
  let appels = 0;
  const up = await amont((_req, res) => {
    appels++;
    res.writeHead(302, { location: 'http://evil.example/' });
    res.end();
  });
  const m = monterSur(up.url);
  const r = await m.appeler(m.jeton);
  assert.equal(r.status, 502);
  assert.equal(appels, 1);
  await m.fermer();
  await up.fermer();
});

test('cible absolue hors amont : 502, rien n’est envoyé', async () => {
  const m = await monter();
  const url = await m.url();
  const statut = await new Promise<number>((ok, ko) => {
    const req = http.request({ host: '127.0.0.1', port: Number(new URL(url).port), method: 'POST', path: 'http://evil.example/v1/messages', headers: { 'x-api-key': m.jeton } }, res => { res.resume(); ok(res.statusCode ?? 0); });
    req.on('error', ko);
    req.end('{}');
  });
  assert.equal(statut, 502);
  assert.equal(m.api.requetes.length, 0);
  await m.fermer();
});

/** Envoie un corps brut à /v1/messages avec des en-têtes choisis. */
async function envoyerCorps(m: Awaited<ReturnType<typeof monter>>, corps: string, entetes: Record<string, string> = {}) {
  return fetch(`${await m.url()}/v1/messages?beta=true`, {
    method: 'POST',
    headers: { 'x-api-key': m.jeton, 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...entetes },
    body: corps,
  });
}

const CORPS_BASE = { model: 'claude-sonnet-5-5', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'go' }] };

test('requêtes ouvrant une sortie côté serveur : 403, rien n’atteint l’amont', async () => {
  const m = await monter();
  const refusees: Array<[string, string]> = [
    ['mcp_servers', JSON.stringify({ ...CORPS_BASE, mcp_servers: [{ type: 'url', url: 'https://evil.example/mcp', name: 'x' }] })],
    ['container', JSON.stringify({ ...CORPS_BASE, container: 'cnt_1' })],
    ['web_fetch', JSON.stringify({ ...CORPS_BASE, tools: [{ name: 'Bash', input_schema: { type: 'object' } }, { type: 'web_fetch_20250910', name: 'web_fetch' }] })],
    ['web_search', JSON.stringify({ ...CORPS_BASE, tools: [{ type: 'web_search_20250305', name: 'web_search' }] })],
    ['code_execution', JSON.stringify({ ...CORPS_BASE, tools: [{ type: 'code_execution_20250825', name: 'code_execution' }] })],
    ['type inconnu', JSON.stringify({ ...CORPS_BASE, tools: [{ type: 'bash_20250124', name: 'bash' }] })],
    ['JSON invalide', '{"model":'],
    ['corps non objet', '[1,2]'],
  ];
  for (const [nom, corps] of refusees) {
    const r = await envoyerCorps(m, corps);
    assert.equal(r.status, 403, nom);
    assert.deepEqual(await r.json(), { type: 'error', error: { type: 'permission_error', message: 'requête non autorisée par le bureau' } }, nom);
  }
  assert.equal(m.api.requetes.length, 0, 'aucune requête refusée n’est relayée');
  await m.fermer();
});

test('corps type Claude Code (outils clients) relayé, bêtas risquées retirées', async () => {
  const m = await monter();
  const corps = {
    ...CORPS_BASE,
    system: [{ type: 'text', text: 'Tu es Claude Code.', cache_control: { type: 'ephemeral' } }],
    tools: [
      { name: 'Bash', description: 'shell', input_schema: { type: 'object', properties: { command: { type: 'string' } } } },
      { type: 'custom', name: 'Edit', input_schema: { type: 'object' } },
    ],
    metadata: { user_id: 'u' }, thinking: { type: 'enabled', budget_tokens: 1024 },
  };
  const r = await envoyerCorps(m, JSON.stringify(corps), {
    'anthropic-beta': 'claude-code-20250219,mcp-client-2025-04-04, code-execution-2025-08-25,web-fetch-2025-09-10,web-search-2025-03-05,skills-2025-10-02,files-api-2025-04-14,interleaved-thinking-2025-05-14',
  });
  assert.equal(r.status, 200);
  await r.text();
  assert.equal(m.api.requetes.length, 1);
  assert.deepEqual(m.api.requetes[0].corps, corps);
  assert.equal(m.api.requetes[0].entetes['anthropic-beta'], 'claude-code-20250219,interleaved-thinking-2025-05-14');
  await m.fermer();
});
