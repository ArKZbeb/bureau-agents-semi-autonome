import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type net from 'node:net';
import { creerServeurUi } from '../../src/reseau/serveur-ui.ts';

const JETON = 'jeton-de-session';

async function monter() {
  const decisions: unknown[] = [];
  let arrets = 0;
  const serveur = creerServeurUi(JETON, {
    taches: () => [{ id: 'T-41' }],
    journal: id => [{ tacheId: id }],
    escalades: () => [{ id: 1 }],
    deciderEscalade: (id, decision, commentaire) => { decisions.push([id, decision, commentaire]); return { ok: true }; },
    arretGlobal: async () => { arrets++; return { conteneursArretes: 2 }; },
  });
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', r));
  const adresse = serveur.address() as net.AddressInfo;
  const appeler = (chemin: string, o: { methode?: string; entetes?: Record<string, string>; corps?: unknown } = {}) =>
    new Promise<{ statut: number; corps: unknown }>((ok, ko) => {
      const req = http.request({ host: '127.0.0.1', port: adresse.port, path: chemin, method: o.methode ?? 'GET',
        headers: { host: `127.0.0.1:${adresse.port}`, authorization: `Bearer ${JETON}`, ...o.entetes } }, res => {
        let t = '';
        res.on('data', d => (t += d));
        res.on('end', () => ok({ statut: res.statusCode ?? 0, corps: t ? JSON.parse(t) : null }));
      });
      req.on('error', ko);
      req.end(o.corps === undefined ? undefined : JSON.stringify(o.corps));
    });
  return { adresse, appeler, decisions, arrets: () => arrets, fermer: () => serveur.close() };
}

test('écoute uniquement sur 127.0.0.1', async () => {
  const m = await monter();
  assert.equal(m.adresse.address, '127.0.0.1');
  m.fermer();
});

test('requête légitime acceptée', async () => {
  const m = await monter();
  assert.deepEqual(await m.appeler('/api/taches'), { statut: 200, corps: [{ id: 'T-41' }] });
  assert.deepEqual((await m.appeler('/api/journal?tache=T-41')).corps, [{ tacheId: 'T-41' }]);
  assert.equal((await m.appeler('/api/taches', { entetes: { origin: `http://localhost:${m.adresse.port}` } })).statut, 200);
  m.fermer();
});

test('DNS rebinding : en-tête Host étranger refusé', async () => {
  const m = await monter();
  assert.equal((await m.appeler('/api/taches', { entetes: { host: `bureau.evil.example:${m.adresse.port}` } })).statut, 403);
  m.fermer();
});

test('site web tiers : Origin étrangère refusée', async () => {
  const m = await monter();
  assert.equal((await m.appeler('/api/arret-global', { methode: 'POST', entetes: { origin: 'https://evil.example' } })).statut, 403);
  assert.equal(m.arrets(), 0);
  m.fermer();
});

test('sans jeton de session : 401', async () => {
  const m = await monter();
  assert.equal((await m.appeler('/api/taches', { entetes: { authorization: 'Bearer faux' } })).statut, 401);
  m.fermer();
});

test('décision d’escalade et arrêt global', async () => {
  const m = await monter();
  assert.equal((await m.appeler('/api/escalades/3', { methode: 'POST', corps: { decision: 'refuser', commentaire: 'paquet douteux' } })).statut, 200);
  assert.deepEqual(m.decisions, [[3, 'refuser', 'paquet douteux']]);
  assert.equal((await m.appeler('/api/escalades/3', { methode: 'POST', corps: { decision: 'peut-être' } })).statut, 400);
  assert.deepEqual((await m.appeler('/api/arret-global', { methode: 'POST' })).corps, { conteneursArretes: 2 });
  m.fermer();
});

test('corps JSON invalide ou non-objet : 400', async () => {
  const m = await monter();
  assert.equal((await m.appeler('/api/escalades/3', { methode: 'POST', corps: [1, 2] })).statut, 400);
  assert.equal((await m.appeler('/api/escalades/3', { methode: 'POST', corps: 'texte' })).statut, 400);
  assert.deepEqual(m.decisions, []);
  m.fermer();
});
