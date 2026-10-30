import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerConfig } from '../../src/config.ts';
import type { Agent, ResultatEtape } from '../../src/conteneurs/execution.ts';
import { ouvrirBase } from '../../src/db.ts';
import { enregistrerArtefact, lireArtefact } from '../../src/integrite/artefacts.ts';
import { lireJournal } from '../../src/integrite/journal.ts';
import type { Controle, DemandeControle } from '../../src/pipeline/controleur.ts';
import { avancer, verdictQa, type DepsPipeline } from '../../src/pipeline/pipeline.ts';
import { numeroterCriteres } from '../../src/pipeline/prompts.ts';
import { appliquer, creerTache, lireTache } from '../../src/taches/depot.ts';
import { RAISON_PROPOSITION, RAISON_QUESTIONS } from '../../src/taches/etats.ts';
import { listerEchanges, lireProposition } from '../../src/taches/echanges.ts';

const cle = Buffer.alloc(32, 11);
const PLAN = '# Plan\n\n## Zones touchées\n\n- `src/**`\n';

const SPEC = "# Spec\n\n## Critères d’acceptation\n\n1. Le PDF contient le synopsis\n";

function banc(sorties: unknown[], o: { controle?: Controle['verdict']; issue?: ResultatEtape; fichiers?: Record<string, string> } = {}) {
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: 'T-41', projet: 'Film', titre: 'Export PDF', cheminProjet: '/p', budgetUsd: 6 });
  enregistrerArtefact(db, cle, 'T-41', 'demande', 'Exporter la fiche film en PDF');
  const appels: { agent: Agent; prompt: string; volume?: string }[] = [];
  const controles: DemandeControle[] = [];
  const copies: string[] = [];
  const lectures: string[] = [];
  const deps: DepsPipeline = {
    db, cle, config: chargerConfig({}), racineDepot: process.cwd(),
    executer: async (id, agent, prompt, options) => {
      appels.push({ agent, prompt, volume: options.volume });
      appliquer(db, id, { type: 'demarrage' });
      // Comme lancerEtape : une pause est appliquée à la tâche avant de rendre la main.
      if (o.issue?.issue === 'pause') appliquer(db, id, { type: 'pause', raison: o.issue.raison, detail: 'simulée' });
      return o.issue ?? { issue: 'terminee', resultat: '', sortie: sorties.shift() };
    },
    copie: async (id, neuve) => { copies.push(`${neuve ? 'neuve' : 'reprise'}:${id}`); return 'bureau-t-41-controle'; },
    supprimerCopie: async id => { copies.push(`supprimee:${id}`); lectures.push('copie supprimée'); },
    controler: async d => { controles.push(d); return { verdict: o.controle ?? 'ok', constats: o.controle === 'signaler' ? ['critère 1 retiré'] : [], coutUsd: 0.001 }; },
    lireFichier: async (volume, chemin) => { lectures.push(`${volume}:${chemin}`); return o.fichiers?.[chemin] ?? null; },
  };
  return { db, deps, appels, controles, copies, lectures };
}

function valider(db: ReturnType<typeof ouvrirBase>) {
  enregistrerArtefact(db, cle, 'T-41', 'spec', '# Spec');
  enregistrerArtefact(db, cle, 'T-41', 'criteres', numeroterCriteres(['Le PDF contient le synopsis']));
  enregistrerArtefact(db, cle, 'T-41', 'plan', PLAN);
  // Le cadrage réel : démarrage, proposition du cadreur, puis ma validation.
  appliquer(db, 'T-41', { type: 'demarrage' });
  appliquer(db, 'T-41', { type: 'etape_terminee', verdict: 'proposition' });
  appliquer(db, 'T-41', { type: 'validation_cadrage' });
}

test('cadrage : questions enregistrées, tâche en attente de ma réponse', async () => {
  const { db, deps, appels } = banc([{ type: 'questions', questions: ['Format A4 ?', 'Logo inclus ?'] }]);
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.etape, t.statut, t.raison, t.agent], ['cadrage', 'attente_humain', RAISON_QUESTIONS, null]);
  assert.deepEqual(listerEchanges(db, 'T-41').map(e => [e.auteur, e.texte]), [['cadreur', 'Format A4 ?\nLogo inclus ?']]);
  assert.equal(appels[0].agent.nom, 'cadreur');
  assert.equal(appels[0].volume, 'bureau-t-41-controle', 'le cadreur travaille sur la copie, jamais sur la branche');
  assert.ok(appels[0].prompt.includes('Exporter la fiche film en PDF'));
});

test('cadrage : fichiers du cadreur copiés en brouillon, rien de signé', async () => {
  const { db, deps, copies, lectures } = banc([{ type: 'proposition' }], { fichiers: { '/workspace/cadrage/spec.md': SPEC, '/workspace/cadrage/plan.md': PLAN } });
  const t = await avancer(deps, 'T-41');
  assert.deepEqual(copies, ['neuve:T-41', 'supprimee:T-41']);
  assert.deepEqual(lectures, [
    'bureau-t-41-controle:/workspace/cadrage/spec.md', 'bureau-t-41-controle:/workspace/cadrage/plan.md', 'copie supprimée',
  ], 'spec.md et plan.md lus dans le volume de la copie, avant sa suppression');
  assert.deepEqual([t.statut, t.raison], ['attente_humain', RAISON_PROPOSITION]);
  assert.deepEqual(lireProposition(db, 'T-41'), { spec: SPEC, criteres: ['Le PDF contient le synopsis'], plan: PLAN });
  assert.equal(lireArtefact(db, cle, 'T-41', 'plan'), undefined);
});

test('cadrage : proposition sans plan.md ou sans critères = étape bloquée', async () => {
  const sansPlan = banc([{ type: 'proposition' }], { fichiers: { '/workspace/cadrage/spec.md': SPEC } });
  assert.equal((await avancer(sansPlan.deps, 'T-41')).statut, 'bloquee');
  const sansCriteres = banc([{ type: 'proposition' }], { fichiers: { '/workspace/cadrage/spec.md': '# Spec', '/workspace/cadrage/plan.md': PLAN } });
  const t = await avancer(sansCriteres.deps, 'T-41');
  assert.deepEqual([t.statut, t.raison], ['bloquee', 'documents du cadreur incomplets : spec.md avec critères numérotés et plan.md attendus']);
});

test('parcours du patron (plan) au QA : copie pour les agents en lecture seule, relais contrôlés', async () => {
  const { db, deps, appels, controles, copies } = banc([
    { verdict: 'ok', note: 'Plan sûr.' },
    { resume: 'Export PDF ajouté, 12 tests verts.' },
    { rapport: 'Aucun problème bloquant.' },
    { note: 'Bien.' },
    { verdict: 'go', criteres: [{ numero: 1, rempli: true, preuve: 'ExportPdf_ContientSynopsis vert' }] },
  ]);
  valider(db);
  for (let i = 0; i < 5; i++) await avancer(deps, 'T-41');
  const t = lireTache(db, 'T-41');
  assert.deepEqual([t.etape, t.statut], ['validation', 'attente_humain']);
  assert.deepEqual(appels.map(a => [a.agent.nom, a.volume ?? 'branche']), [
    ['patron', 'bureau-t-41-controle'], ['implementeur', 'branche'], ['reviewer', 'bureau-t-41-controle'],
    ['patron', 'bureau-t-41-controle'], ['qa', 'bureau-t-41-controle'],
  ]);
  assert.deepEqual(controles.map(c => c.relais), ['Cadrage → Patron (plan)', 'Patron (plan) → Implémentation', 'Implémentation → Review', 'Review → Patron (code)', 'Patron (code) → QA']);
  assert.deepEqual(controles[0].criteresValides, ['Le PDF contient le synopsis']);
  assert.equal(copies.filter(c => c.startsWith('neuve')).length, 4);
  assert.equal(copies.filter(c => c.startsWith('supprimee')).length, 4);
  assert.equal(lireArtefact(db, cle, 'T-41', 'resume')?.contenu, 'Export PDF ajouté, 12 tests verts.');
  assert.equal(lireArtefact(db, cle, 'T-41', 'avis_patron')?.contenu, 'Plan sûr.');
  assert.ok(t.depenseUsd > 0, 'coût du contrôleur compté');
});

test('QA : critère absent ou non rempli = no-go, retour à l’implémentation', async () => {
  assert.equal(verdictQa({ verdict: 'go', criteres: [] }, ['A']), 'no_go');
  assert.equal(verdictQa({ verdict: 'go', criteres: [{ numero: 1, rempli: false, preuve: '' }] }, ['A']), 'no_go');
  assert.equal(verdictQa({ verdict: 'no_go', criteres: [{ numero: 1, rempli: true, preuve: 'x' }] }, ['A']), 'no_go');
  assert.equal(verdictQa({ verdict: 'go', criteres: [{ numero: 1, rempli: true, preuve: 'x' }] }, ['A']), 'go');
});

test('contrôleur : signalement = pause d’intégrité, sans lancer l’agent', async () => {
  const { db, deps, appels } = banc([], { controle: 'signaler' });
  valider(db);
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.raison], ['en_pause', 'integrite : contrôleur d’intégrité : critère 1 retiré']);
  assert.equal(appels.length, 0);
  assert.equal(lireJournal(db, 'T-41').at(-1)?.decideur, 'Contrôleur d’intégrité');
});

test('contrôleur indisponible : pause erreur_api', async () => {
  const { db, deps } = banc([], { controle: 'indisponible' });
  valider(db);
  assert.equal((await avancer(deps, 'T-41')).raison?.split(' : ')[0], 'erreur_api');
});

test('document altéré : pause d’intégrité avant tout agent', async () => {
  const { db, deps, appels } = banc([]);
  valider(db);
  db.prepare("UPDATE artefacts SET contenu = '# Plan sans zones' WHERE type = 'plan'").run();
  const t = await avancer(deps, 'T-41');
  assert.equal(t.raison?.split(' : ')[0], 'integrite');
  assert.equal(appels.length, 0);
});

test('sortie illisible : étape bloquée, copie supprimée', async () => {
  const { db, deps, copies } = banc([{ verdict: 'peut-être' }]);
  valider(db);
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.raison], ['bloquee', 'sortie de l’agent illisible : étape à relancer']);
  assert.ok(copies.includes('supprimee:T-41'));
  assert.equal(t.agent, null);
});

test('pause pendant l’étape : copie conservée pour la reprise', async () => {
  const { db, deps, copies } = banc([], { issue: { issue: 'pause', raison: 'escalade' } });
  valider(db);
  await avancer(deps, 'T-41');
  assert.deepEqual(copies, ['neuve:T-41']);
});

test('tâche non prête ou en validation : rien ne se passe', async () => {
  const { db, deps, appels } = banc([]);
  appliquer(db, 'T-41', { type: 'demarrage' });
  await avancer(deps, 'T-41');
  assert.equal(appels.length, 0);
});

test('executer qui lève : pause erreur_api journalisée, agent libéré, copie conservée pour la reprise', async () => {
  const { db, deps, copies } = banc([]);
  valider(db);
  deps.executer = async id => { appliquer(db, id, { type: 'demarrage' }); throw new Error('Docker ne répond plus'); };
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.agent], ['en_pause', null]);
  assert.ok(t.raison?.startsWith('erreur_api'));
  assert.equal(lireJournal(db, 'T-41').at(-1)?.decision, 'Refusé');
  assert.deepEqual(copies, ['neuve:T-41']);
});

test('QA : critères signés altérés pendant l’étape = pause d’intégrité', async () => {
  const { db, deps } = banc([
    { verdict: 'ok', note: 'Plan sûr.' }, { resume: 'Fait.' }, { rapport: 'RAS.' }, { note: 'Bien.' },
  ]);
  valider(db);
  for (let i = 0; i < 4; i++) await avancer(deps, 'T-41');
  deps.executer = async id => {
    db.prepare("UPDATE artefacts SET contenu = '1. Rien' WHERE type = 'criteres'").run();
    appliquer(db, id, { type: 'demarrage' });
    return { issue: 'terminee', resultat: '', sortie: { verdict: 'go', criteres: [{ numero: 1, rempli: true, preuve: 'x' }] } };
  };
  const t = await avancer(deps, 'T-41');
  assert.equal(t.etape, 'qa');
  assert.ok(t.raison?.startsWith('integrite'));
  assert.deepEqual([t.statut, t.agent], ['en_pause', null]);
});

test('verdictQa : aucun critère signé = no-go (fail-closed)', () => {
  assert.equal(verdictQa({ verdict: 'go', criteres: [] }, []), 'no_go');
});

test('étape bloquée par l’exécution : copie supprimée, agent libéré', async () => {
  const { db, deps, copies } = banc([]);
  valider(db);
  deps.executer = async id => { appliquer(db, id, { type: 'demarrage' }); appliquer(db, id, { type: 'bloquee', detail: 'duree' }); return { issue: 'bloquee', raison: 'duree' }; };
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.agent], ['bloquee', null]);
  assert.ok(copies.includes('supprimee:T-41'));
});

test('document signé manquant : pause d’intégrité, aucun agent lancé', async () => {
  const { db, deps, appels, controles } = banc([]);
  valider(db);
  // Étape de review sans résumé jamais signé (une suppression serait déjà vue par le registre des versions).
  db.prepare("UPDATE taches SET etape = 'review' WHERE id = 'T-41'").run();
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.raison], ['en_pause', 'integrite : document manquant : resume']);
  assert.equal(appels.length, 0);
  assert.equal(controles.length, 0);
  assert.equal(lireJournal(db, 'T-41').at(-1)?.decideur, 'Contrôleur d’intégrité');
});
