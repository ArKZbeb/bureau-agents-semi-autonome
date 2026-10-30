import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type net from 'node:net';
import { creerServeurUi } from '../../src/reseau/serveur-ui.ts';

const JETON = 'jeton-de-session';

async function monter() {
  const decisions: unknown[] = [];
  let arrets = 0;
  let reprises = 0;
  const actions: unknown[] = [];
  const creations: unknown[] = [];
  const relies: unknown[] = [];
  const serveur = creerServeurUi(JETON, {
    taches: () => [{ id: 'T-41' }],
    journal: id => [{ tacheId: id }],
    escalades: () => [{ id: 1 }],
    deciderEscalade: (id, decision, commentaire) => { decisions.push([id, decision, commentaire]); return { ok: true }; },
    arretGlobal: async () => { arrets++; return { conteneursArretes: 2 }; },
    repriseGlobale: () => { reprises++; return { ordonnanceur: 'actif' }; },
    etat: () => ({ ordonnanceur: 'actif' }),
    projets: () => [{ nom: 'Planning' }],
    detecterProjet: chemin => { if (chemin === '/introuvable') throw new Error('dossier introuvable : /introuvable'); return { chemin }; },
    relierProjet: p => { if (p.nom === 'Doublon') throw new Error('projet déjà relié : Doublon'); relies.push(p); return p; },
    integriteJournal: () => ({ intacte: true, entrees: 3 }),
    tache: id => (id === 'T-41' ? { id } : null),
    creerTache: async t => { if (t.projet === 'Inconnu') throw new Error('projet non relié : Inconnu'); creations.push(t); return { id: 'T-42', ...t }; },
    action: (id, nom, corps) => { if (nom === 'reprise' && id === 'T-99') throw new Error('T-99 ne se reprend pas ainsi'); actions.push([id, nom, corps]); return { ok: true }; },
  });
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', r));
  const adresse = serveur.address() as net.AddressInfo;
  const appeler = (chemin: string, o: { methode?: string; entetes?: Record<string, string>; corps?: unknown; brut?: string } = {}) =>
    new Promise<{ statut: number; corps: unknown }>((ok, ko) => {
      const req = http.request({ host: '127.0.0.1', port: adresse.port, path: chemin, method: o.methode ?? 'GET',
        headers: { host: `127.0.0.1:${adresse.port}`, authorization: `Bearer ${JETON}`, ...o.entetes } }, res => {
        let t = '';
        res.on('data', d => (t += d));
        res.on('end', () => ok({ statut: res.statusCode ?? 0, corps: t ? JSON.parse(t) : null }));
      });
      req.on('error', ko);
      req.end(o.brut ?? (o.corps === undefined ? undefined : JSON.stringify(o.corps)));
    });
  return { adresse, appeler, decisions, actions, creations, relies, arrets: () => arrets, reprises: () => reprises, fermer: () => serveur.close() };
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

test('routes du pipeline : lecture, création, actions, erreurs 404 / 400 / 409', async () => {
  const s = await monter();
  assert.deepEqual(await s.appeler('/api/taches/T-41'), { statut: 200, corps: { id: 'T-41' } });
  assert.equal((await s.appeler('/api/taches/T-00')).statut, 404);
  const cree = await s.appeler('/api/taches', { methode: 'POST', corps: { projet: 'Film', titre: 'Export PDF', demande: 'Exporter en PDF' } });
  assert.equal(cree.statut, 200);
  assert.equal((await s.appeler('/api/taches', { methode: 'POST', corps: { titre: 'sans projet' } })).statut, 400);
  assert.equal((await s.appeler('/api/taches/T-41/reponse', { methode: 'POST', corps: { texte: 'A4' } })).statut, 200);
  assert.deepEqual(s.actions.at(-1), ['T-41', 'reponse', { texte: 'A4' }]);
  assert.equal((await s.appeler('/api/taches/T-41/inconnue', { methode: 'POST', corps: {} })).statut, 404);
  assert.deepEqual(await s.appeler('/api/taches/T-99/reprise', { methode: 'POST', corps: {} }), { statut: 409, corps: { erreur: 'T-99 ne se reprend pas ainsi' } });
  s.fermer();
});

test('reprise globale : réactive l’ordonnanceur, derrière les mêmes contrôles', async () => {
  const m = await monter();
  assert.equal((await m.appeler('/api/reprise-globale', { methode: 'POST', entetes: { origin: 'https://evil.example' } })).statut, 403);
  assert.equal((await m.appeler('/api/reprise-globale', { methode: 'POST', entetes: { authorization: 'Bearer faux' } })).statut, 401);
  assert.equal((await m.appeler('/api/reprise-globale', { methode: 'POST', entetes: { host: `bureau.evil.example:${m.adresse.port}` } })).statut, 403);
  assert.equal((await m.appeler('/api/reprise-globale')).statut, 404, 'GET refusé');
  assert.equal(m.reprises(), 0);
  assert.deepEqual(await m.appeler('/api/reprise-globale', { methode: 'POST' }), { statut: 200, corps: { ordonnanceur: 'actif' } });
  assert.equal(m.reprises(), 1);
  m.fermer();
});

test('création d’une tâche : projet, titre et demande seulement', async () => {
  const m = await monter();
  const r = await m.appeler('/api/taches', { methode: 'POST', corps: { projet: 'Planning', titre: 'Export PDF', demande: 'Exporter la fiche', cheminProjet: '/etc', budgetUsd: 999, id: 'T-1' } });
  assert.equal(r.statut, 200);
  assert.deepEqual(m.creations, [{ projet: 'Planning', titre: 'Export PDF', demande: 'Exporter la fiche' }]);
  for (const corps of [{ projet: 'Planning', titre: ' ', demande: 'x' }, { projet: 'Planning', titre: 'x' }, { projet: 3, titre: 'x', demande: 'y' }])
    assert.equal((await m.appeler('/api/taches', { methode: 'POST', corps })).statut, 400);
  assert.deepEqual(await m.appeler('/api/taches', { methode: 'POST', corps: { projet: 'Inconnu', titre: 'x', demande: 'y' } }), { statut: 409, corps: { erreur: 'projet non relié : Inconnu' } });
  m.fermer();
});

test('projets : liste, détection, liaison', async () => {
  const m = await monter();
  assert.deepEqual((await m.appeler('/api/projets')).corps, [{ nom: 'Planning' }]);
  assert.deepEqual(await m.appeler('/api/projets/detection', { methode: 'POST', corps: { chemin: '/depots/planning' } }), { statut: 200, corps: { chemin: '/depots/planning' } });
  assert.equal((await m.appeler('/api/projets/detection', { methode: 'POST', corps: { chemin: 'relatif' } })).statut, 400);
  assert.deepEqual(await m.appeler('/api/projets/detection', { methode: 'POST', corps: { chemin: '/introuvable' } }), { statut: 409, corps: { erreur: 'dossier introuvable : /introuvable' } });
  const ok = { nom: 'Planning', chemin: '/depots/planning', budgetUsd: 6, couvertureLignes: 80 };
  assert.equal((await m.appeler('/api/projets', { methode: 'POST', corps: { ...ok, extra: 1 } })).statut, 200);
  assert.deepEqual(m.relies, [ok]);
  for (const corps of [{ ...ok, chemin: 'relatif' }, { ...ok, budgetUsd: '6' }, { ...ok, couvertureLignes: 80.5 }, { ...ok, nom: '' }])
    assert.equal((await m.appeler('/api/projets', { methode: 'POST', corps })).statut, 400);
  assert.equal((await m.appeler('/api/projets', { methode: 'POST', corps: { ...ok, nom: 'Doublon' } })).statut, 409);
  m.fermer();
});

test('état global et intégrité du journal', async () => {
  const m = await monter();
  assert.deepEqual((await m.appeler('/api/etat')).corps, { ordonnanceur: 'actif' });
  assert.deepEqual((await m.appeler('/api/journal/integrite')).corps, { intacte: true, entrees: 3 });
  m.fermer();
});

test('les nouvelles routes exigent le jeton', async () => {
  const m = await monter();
  for (const chemin of ['/api/etat', '/api/projets', '/api/journal/integrite'])
    assert.equal((await m.appeler(chemin, { entetes: { authorization: 'Bearer faux' } })).statut, 401);
  m.fermer();
});
