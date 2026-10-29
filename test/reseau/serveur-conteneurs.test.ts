import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { creerServeurConteneurs } from '../../src/reseau/serveur-conteneurs.ts';
import { Jetons } from '../../src/reseau/jetons.ts';
import type { EntreeHook } from '../../src/gardien/service.ts';

async function monter() {
  const echo = net.createServer(s => s.pipe(s));
  await new Promise<void>(r => echo.listen(0, '127.0.0.1', r));
  const portEcho = (echo.address() as net.AddressInfo).port;
  const jetons = new Jetons();
  const jeton = jetons.creer('T-41', 60_000);
  const appels: [string, EntreeHook][] = [];
  const refus: [string | null, string][] = [];
  let apiAppelee = false;
  const serveur = creerServeurConteneurs({
    jetons, domaines: ['127.0.0.1'], ports: [portEcho],
    gardien: async (id, e) => { appels.push([id, e]); return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'ok' } }; },
    api: async (_req, res) => { apiAppelee = true; res.end('api'); },
    journaliserRefus: (id, cible) => refus.push([id, cible]),
  });
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', r));
  const port = (serveur.address() as net.AddressInfo).port;
  const fermer = () => { serveur.close(); echo.close(); };
  return { port, portEcho, jeton, appels, refus, api: () => apiAppelee, fermer };
}

const connect = (port: number, cible: string, jeton?: string) => new Promise<{ statut: number; socket: net.Socket }>((ok, ko) => {
  const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: cible, headers: jeton ? { 'proxy-authorization': `Basic ${Buffer.from(`tache:${jeton}`).toString('base64')}` } : {} });
  req.on('connect', (res, socket) => ok({ statut: res.statusCode ?? 0, socket }));
  req.on('error', ko);
  req.end();
});

test('POST /gardien : jeton exigé, décision renvoyée', async () => {
  const m = await monter();
  const corps = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, tool_use_id: 'toolu_1' });
  const sans = await fetch(`http://127.0.0.1:${m.port}/gardien`, { method: 'POST', body: corps });
  assert.equal(sans.status, 401);
  const avec = await fetch(`http://127.0.0.1:${m.port}/gardien`, { method: 'POST', body: corps, headers: { authorization: `Bearer ${m.jeton}` } });
  assert.equal((await avec.json()).hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(m.appels[0][0], 'T-41');
  assert.equal(m.appels[0][1].tool_use_id, 'toolu_1');
  m.fermer();
});

test('/v1/* relayé vers le proxy API', async () => {
  const m = await monter();
  assert.equal(await (await fetch(`http://127.0.0.1:${m.port}/v1/messages`, { method: 'POST', body: '{}' })).text(), 'api');
  assert.ok(m.api());
  m.fermer();
});

test('CONNECT vers une cible autorisée : tunnel établi', async () => {
  const m = await monter();
  const { statut, socket } = await connect(m.port, `127.0.0.1:${m.portEcho}`, m.jeton);
  assert.equal(statut, 200);
  socket.write('ping');
  const [donnees] = await new Promise<[Buffer]>(r => socket.once('data', d => r([d])));
  assert.equal(donnees.toString(), 'ping');
  socket.destroy();
  m.fermer();
});

test('CONNECT hors liste blanche : 403 et journalisé', async () => {
  const m = await monter();
  assert.equal((await connect(m.port, 'evil.example:443', m.jeton)).statut, 403);
  assert.equal((await connect(m.port, `127.0.0.1:22`, m.jeton)).statut, 403);
  assert.deepEqual(m.refus, [['T-41', 'evil.example:443'], ['T-41', '127.0.0.1:22']]);
  m.fermer();
});

test('CONNECT sans jeton : 407', async () => {
  const m = await monter();
  assert.equal((await connect(m.port, `127.0.0.1:${m.portEcho}`)).statut, 407);
  m.fermer();
});

test('proxy HTTP en clair refusé', async () => {
  const m = await monter();
  const statut = await new Promise<number>(r => http.get({ host: '127.0.0.1', port: m.port, path: 'http://example.com/' }, res => r(res.statusCode ?? 0)));
  assert.equal(statut, 403);
  m.fermer();
});
