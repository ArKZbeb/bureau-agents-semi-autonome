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

async function monter(budgetUsd = 6) {
  const api = await demarrerFausseApi([{ outil: { nom: 'Bash', entree: { command: 'dotnet test' } } }]);
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: 'T-41', projet: 'Film', titre: 't', cheminProjet: '/p', budgetUsd });
  const jetons = new Jetons();
  const jeton = jetons.creer('T-41', 60_000);
  const budgets: string[] = [];
  const serveur = http.createServer((req, res) => void relayerApi({ db, jetons, urlAmont: api.url, cleApi: CLE, tarifs: TARIFS, surBudgetDepasse: id => budgets.push(id) }, req, res));
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(serveur.address() as { port: number }).port}`;
  const appeler = (cle: string, stream = true) => fetch(`${url}/v1/messages?beta=true`, {
    method: 'POST', headers: { 'x-api-key': cle, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 10, stream, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'go' }] }),
  });
  const fermer = async () => { serveur.close(); await api.fermer(); };
  return { api, db, jeton, budgets, appeler, fermer };
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
