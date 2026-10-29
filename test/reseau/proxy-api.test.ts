import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ouvrirBase } from '../../src/db.ts';
import { creerTache, lireTache } from '../../src/taches/depot.ts';
import { Jetons } from '../../src/reseau/jetons.ts';
import { relayerApi } from '../../src/reseau/proxy-api.ts';
import { TARIFS } from '../../src/config.ts';
import { demarrerFausseApi } from '../outils/fausse-api.ts';

const CLE = 'cle-reelle-de-test';

/** Proxy API seul, relié à un amont quelconque. Chaque traitement est mémorisé pour l'attendre. */
function monterSur(urlAmont: string, budgetUsd = 6) {
  const db = ouvrirBase(':memory:');
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
  if (r) await r.text().catch(() => undefined);
  await Promise.all(m.traitements);
  assert.ok(lireTache(m.db, 'T-41').depenseUsd > 0, 'la dépense partielle est imputée');
  await m.fermer();
  await up.fermer();
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
