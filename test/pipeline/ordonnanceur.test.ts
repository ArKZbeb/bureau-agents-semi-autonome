import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerConfig } from '../../src/config.ts';
import { ouvrirBase } from '../../src/db.ts';
import { lireJournal } from '../../src/integrite/journal.ts';
import type { DepsPipeline } from '../../src/pipeline/pipeline.ts';
import { creerOrdonnanceur } from '../../src/pipeline/ordonnanceur.ts';
import { appliquer, creerTache, lireTache } from '../../src/taches/depot.ts';

const cle = Buffer.alloc(32, 13);

function banc(n: number) {
  const db = ouvrirBase(':memory:');
  for (let i = 1; i <= n; i++) creerTache(db, { id: `T-${i}`, projet: 'p', titre: 't', cheminProjet: '/p', budgetUsd: 6 });
  const lances: string[] = [];
  let liberer: () => void = () => {};
  const bloque = new Promise<void>(r => { liberer = r; });
  const deps = {
    db, cle, config: chargerConfig({}), racineDepot: process.cwd(),
  } as unknown as DepsPipeline;
  return { db, deps, lances, bloque, liberer: () => liberer() };
}

test('lance au plus N tâches prêtes, jamais deux fois la même', async () => {
  const b = banc(3);
  const o = creerOrdonnanceur(b.deps, { simultanees: 2, intervalleMs: 10, delaisErreurApiMs: [] }, async (_d, id) => { b.lances.push(id); await b.bloque; return lireTache(b.db, id); });
  await o.tour();
  await o.tour();
  assert.deepEqual(b.lances, ['T-1', 'T-2']);
  assert.deepEqual(o.enVol(), ['T-1', 'T-2']);
  b.liberer();
  await o.arreter();
});

test('pause erreur_api reprise après chaque délai, puis abandonnée à la main', async () => {
  const b = banc(1);
  let maintenant = 0;
  appliquer(b.db, 'T-1', { type: 'demarrage' });
  appliquer(b.db, 'T-1', { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  const o = creerOrdonnanceur(b.deps, { simultanees: 1, intervalleMs: 10, delaisErreurApiMs: [1000, 5000], horloge: () => maintenant }, async (_d, id) => {
    appliquer(b.db, id, { type: 'demarrage' });
    return appliquer(b.db, id, { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  });
  await o.tour();
  assert.equal(lireTache(b.db, 'T-1').statut, 'en_pause', 'délai pas écoulé');
  maintenant = 1000; await o.tour(); await o.tour();
  maintenant = 7000; await o.tour(); await o.tour();
  maintenant = 99_000; await o.tour(); await o.tour();
  assert.equal(lireTache(b.db, 'T-1').statut, 'en_pause');
  assert.equal(lireJournal(b.db, 'T-1').filter(e => /tentatives épuisées/.test(e.raison)).length, 1);
  await o.arreter();
});

test('le compteur de tentatives survit à une relance en cours d’étape', async () => {
  const b = banc(1);
  let maintenant = 0;
  appliquer(b.db, 'T-1', { type: 'demarrage' });
  appliquer(b.db, 'T-1', { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  const portes: (() => void)[] = [];
  const lances: string[] = [];
  const o = creerOrdonnanceur(b.deps, { simultanees: 1, intervalleMs: 10, delaisErreurApiMs: [1000], horloge: () => maintenant }, async (_d, id) => {
    lances.push(id);
    appliquer(b.db, id, { type: 'demarrage' });
    await new Promise<void>(r => portes.push(r));
    return appliquer(b.db, id, { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  });
  const laisserFinir = () => new Promise(r => setImmediate(r));
  await o.tour();
  maintenant = 1000; await o.tour();
  maintenant = 2000; await o.tour();
  assert.equal(lireTache(b.db, 'T-1').statut, 'en_cours');
  portes.shift()!();
  await laisserFinir();
  assert.equal(lireTache(b.db, 'T-1').statut, 'en_pause');
  maintenant = 3000; await o.tour();
  maintenant = 4000; await o.tour();
  assert.deepEqual(lances, ['T-1'], 'un seul délai : pas de nouvelle relance');
  assert.equal(lireJournal(b.db, 'T-1').filter(e => /tentatives épuisées/.test(e.raison)).length, 1);
  await o.arreter();
});

test('exception pendant une étape : pause erreur_api journalisée', async () => {
  const b = banc(1);
  const o = creerOrdonnanceur(b.deps, { simultanees: 1, intervalleMs: 10, delaisErreurApiMs: [] }, async (_d, id) => {
    appliquer(b.db, id, { type: 'demarrage' });
    throw new Error('Docker ne répond plus');
  });
  await o.tour();
  await o.arreter();
  assert.match(lireTache(b.db, 'T-1').raison ?? '', /^erreur_api : Docker ne répond plus/);
});

test('délai compté depuis l’observation de la pause, pas depuis la reprise', async () => {
  const b = banc(1);
  let maintenant = 0;
  appliquer(b.db, 'T-1', { type: 'demarrage' });
  appliquer(b.db, 'T-1', { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  const portes: (() => void)[] = [];
  const lances: string[] = [];
  const o = creerOrdonnanceur(b.deps, { simultanees: 1, intervalleMs: 10, delaisErreurApiMs: [1000, 5000], horloge: () => maintenant }, async (_d, id) => {
    lances.push(id);
    appliquer(b.db, id, { type: 'demarrage' });
    await new Promise<void>(r => portes.push(r));
    return appliquer(b.db, id, { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  });
  const laisserFinir = () => new Promise(r => setImmediate(r));
  await o.tour();
  maintenant = 1000; await o.tour();
  maintenant = 8000; await o.tour();
  portes.shift()!();
  await laisserFinir();
  assert.equal(lireTache(b.db, 'T-1').statut, 'en_pause');
  await o.tour();
  assert.deepEqual(lances, ['T-1'], 'pause observée à 8 000 : pas de relance immédiate');
  maintenant = 12_000; await o.tour();
  assert.deepEqual(lances, ['T-1'], 'délai de 5 000 ms compté depuis 8 000');
  maintenant = 13_000; await o.tour();
  assert.deepEqual(lances, ['T-1', 'T-1']);
  portes.shift()!();
  await laisserFinir();
  await o.arreter();
});

test('reprise humaine après épuisement : la pause suivante est à nouveau relancée', async () => {
  const b = banc(1);
  let maintenant = 0;
  appliquer(b.db, 'T-1', { type: 'demarrage' });
  appliquer(b.db, 'T-1', { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  const lances: string[] = [];
  const o = creerOrdonnanceur(b.deps, { simultanees: 1, intervalleMs: 10, delaisErreurApiMs: [1000], horloge: () => maintenant }, async (_d, id) => {
    lances.push(id);
    appliquer(b.db, id, { type: 'demarrage' });
    return appliquer(b.db, id, { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  });
  await o.tour();
  maintenant = 1000; await o.tour(); await o.tour();
  maintenant = 2000; await o.tour();
  assert.equal(lireJournal(b.db, 'T-1').filter(e => /tentatives épuisées/.test(e.raison)).length, 1);
  assert.deepEqual(lances, ['T-1']);
  appliquer(b.db, 'T-1', { type: 'reprise' });
  maintenant = 2500; await o.tour(); await o.tour();
  assert.deepEqual(lances, ['T-1', 'T-1'], 'reprise humaine lancée');
  maintenant = 3000; await o.tour();
  assert.deepEqual(lances, ['T-1', 'T-1'], 'délai pas écoulé depuis l’observation');
  maintenant = 3500; await o.tour();
  assert.deepEqual(lances, ['T-1', 'T-1', 'T-1'], 'nouveau délai écoulé : relancée');
  await o.arreter();
});

test('erreur de tour pendant le minuteur : journalisée, pas de promesse rejetée', async () => {
  const b = banc(1);
  let premier = true;
  const o = creerOrdonnanceur(b.deps, { simultanees: 1, intervalleMs: 1, delaisErreurApiMs: [], horloge: () => {
    if (premier) { premier = false; throw new Error('horloge cassée'); }
    return 0;
  } }, async (_d, id) => lireTache(b.db, id));
  o.demarrer();
  await new Promise(r => setTimeout(r, 30));
  await o.arreter();
  const entrees = lireJournal(b.db).filter(e => /horloge cassée/.test(e.raison));
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].tacheId, '—');
  assert.equal(entrees[0].decideur, 'Orchestrateur');
});

test('suspendu (arrêt global) : ni lancement ni reprise de pause erreur_api échue ; réactivé : comportement normal', async () => {
  const b = banc(1);
  let maintenant = 0;
  appliquer(b.db, 'T-1', { type: 'demarrage' });
  appliquer(b.db, 'T-1', { type: 'pause', raison: 'erreur_api', detail: '529 : surcharge' });
  const lances: string[] = [];
  const o = creerOrdonnanceur(b.deps, { simultanees: 2, intervalleMs: 10, delaisErreurApiMs: [1000], horloge: () => maintenant }, async (_d, id) => {
    lances.push(id);
    return lireTache(b.db, id);
  });
  await o.tour(); // pause observée à 0
  o.suspendre();
  creerTache(b.db, { id: 'T-2', projet: 'p', titre: 't', cheminProjet: '/p', budgetUsd: 6 });
  maintenant = 5000; await o.tour(); await o.tour();
  assert.deepEqual(lances, [], 'rien n’est lancé pendant la suspension');
  assert.equal(lireTache(b.db, 'T-1').statut, 'en_pause', 'pause échue non reprise pendant la suspension');
  assert.equal(lireTache(b.db, 'T-2').statut, 'prete');
  o.reactiver();
  await o.tour();
  assert.equal(lireTache(b.db, 'T-1').statut, 'prete', 'pause échue reprise après réactivation');
  assert.deepEqual([...lances].sort(), ['T-1', 'T-2']);
  await o.arreter();
});

test('pauses integrite, arret_global, budget et escalade : jamais reprises, même délais écoulés', async () => {
  const b = banc(4);
  let maintenant = 0;
  const raisons = ['integrite', 'arret_global', 'budget', 'escalade'] as const;
  raisons.forEach((raison, i) => {
    appliquer(b.db, `T-${i + 1}`, { type: 'demarrage' });
    appliquer(b.db, `T-${i + 1}`, { type: 'pause', raison, detail: 'x' });
  });
  const lances: string[] = [];
  const o = creerOrdonnanceur(b.deps, { simultanees: 4, intervalleMs: 10, delaisErreurApiMs: [1, 1, 1] , horloge: () => maintenant }, async (_d, id) => {
    lances.push(id);
    return lireTache(b.db, id);
  });
  for (const t of [0, 10, 1000, 1_000_000, 1e9]) { maintenant = t; await o.tour(); await o.tour(); }
  assert.deepEqual(lances, []);
  raisons.forEach((raison, i) => {
    const t = lireTache(b.db, `T-${i + 1}`);
    assert.equal(t.statut, 'en_pause');
    assert.equal(t.raison, `${raison} : x`);
  });
  await o.arreter();
});

test('erreur dans le gestionnaire d’échec d’une étape : aucune promesse rejetée non gérée', async () => {
  const b = banc(1);
  const rejets: unknown[] = [];
  const surRejet = (e: unknown) => rejets.push(e);
  process.on('unhandledRejection', surRejet);
  try {
    const o = creerOrdonnanceur(b.deps, { simultanees: 1, intervalleMs: 10, delaisErreurApiMs: [] }, async () => {
      b.db.close(); // le gestionnaire ne peut plus lire la tâche ni écrire au journal
      throw new Error('Docker ne répond plus');
    });
    await o.tour();
    await o.arreter();
    await new Promise(r => setImmediate(r));
    assert.deepEqual(rejets, []);
  } finally {
    process.off('unhandledRejection', surRejet);
  }
});
