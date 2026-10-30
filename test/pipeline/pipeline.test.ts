import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerConfig } from '../../src/config.ts';
import type { Agent, ResultatEtape } from '../../src/conteneurs/execution.ts';
import { ouvrirBase } from '../../src/db.ts';
import { AnomalieIntegrite } from '../../src/integrite/anomalie.ts';
import { enregistrerArtefact, lireArtefact } from '../../src/integrite/artefacts.ts';
import { lireJournal } from '../../src/integrite/journal.ts';
import type { Controle, DemandeControle } from '../../src/pipeline/controleur.ts';
import { avancer, type DepsPipeline } from '../../src/pipeline/pipeline.ts';
import { numeroterCriteres } from '../../src/pipeline/prompts.ts';
import type { Analyse } from '../../src/analyse/analyse.ts';
import { appliquer, creerTache, definirCommitBase, definirReprise, lireTache } from '../../src/taches/depot.ts';
import { definirSeuils } from '../../src/taches/seuils.ts';
import { RAISON_PROPOSITION, RAISON_QUESTIONS } from '../../src/taches/etats.ts';
import { listerEchanges, lireProposition } from '../../src/taches/echanges.ts';

const cle = Buffer.alloc(32, 11);
const PLAN = '# Plan\n\n## Zones touchées\n\n- `src/**`\n';

const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const ANALYSE_VERTE: Analyse = {
  sha: SHA, base: BASE,
  outils: { tests_dotnet: 'ok', audit_dotnet: 'ok', tests_angular: 'non_applicable', audit_npm: 'non_applicable', semgrep: 'ok', gitleaks: 'ok', couverture: 'ok' },
  tests: { total: 12, echecs: 0 }, couverture: { couvertes: 9, total: 10, pourcentage: 90, sourcesHorsCouverture: [] }, constats: [], signalements: [],
};

const SPEC = "# Spec\n\n## Critères d’acceptation\n\n1. Le PDF contient le synopsis\n";

function banc(sorties: unknown[], o: { controle?: Controle['verdict']; issue?: ResultatEtape; fichiers?: Record<string, string>; analyse?: Analyse; sha?: string | null; base?: string | null } = {}) {
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: 'T-41', projet: 'Film', titre: 'Export PDF', cheminProjet: '/p', budgetUsd: 6 });
  if (o.base !== null) definirCommitBase(db, 'T-41', o.base ?? BASE);
  enregistrerArtefact(db, cle, 'T-41', 'demande', 'Exporter la fiche film en PDF');
  const analyses: [string, string, string][] = [];
  const appels: { agent: Agent; prompt: string; volume?: string }[] = [];
  const controles: DemandeControle[] = [];
  const copies: string[] = [];
  const lectures: string[] = [];
  const ordre: string[] = [];
  const deps: DepsPipeline = {
    db, cle, config: chargerConfig({}), racineDepot: process.cwd(),
    executer: async (id, agent, prompt, options) => {
      appels.push({ agent, prompt, volume: options.volume });
      ordre.push(`agent:${agent.nom}`);
      appliquer(db, id, { type: 'demarrage' });
      // Comme lancerEtape : une pause est appliquée à la tâche avant de rendre la main.
      if (o.issue?.issue === 'pause') appliquer(db, id, { type: 'pause', raison: o.issue.raison, detail: 'simulée' });
      return o.issue ?? { issue: 'terminee', resultat: '', sortie: sorties.shift() };
    },
    copie: async (id, neuve) => { copies.push(`${neuve ? 'neuve' : 'reprise'}:${id}`); ordre.push(`copie:${neuve ? 'neuve' : 'reprise'}`); return 'bureau-t-41-controle'; },
    supprimerCopie: async id => { copies.push(`supprimee:${id}`); lectures.push('copie supprimée'); },
    controler: async d => { controles.push(d); return { verdict: o.controle ?? 'ok', constats: o.controle === 'signaler' ? ['critère 1 retiré'] : [], coutUsd: 0.001 }; },
    analyser: async (id, volume, base) => { analyses.push([id, volume, base]); ordre.push('analyse'); return o.analyse ?? ANALYSE_VERTE; },
    shaCopie: async () => { ordre.push('sha'); return o.sha === undefined ? SHA : o.sha; },
    lireFichier: async (volume, chemin) => { lectures.push(`${volume}:${chemin}`); return o.fichiers?.[chemin] ?? null; },
  };
  return { db, deps, appels, controles, copies, lectures, analyses, ordre };
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
  // Review : une copie neuve pour l'analyse, une autre pour le reviewer (la première a exécuté le code du dépôt).
  assert.equal(copies.filter(c => c.startsWith('neuve')).length, 5);
  assert.equal(copies.filter(c => c.startsWith('supprimee')).length, 4);
  assert.equal(lireArtefact(db, cle, 'T-41', 'resume')?.contenu, 'Export PDF ajouté, 12 tests verts.');
  assert.equal(lireArtefact(db, cle, 'T-41', 'avis_patron')?.contenu, 'Plan sûr.');
  assert.ok(t.depenseUsd > 0, 'coût du contrôleur compté');
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

const REPRISE = { sessionId: 'session-1', mode: 'defer' as const, message: null, empreinteTranscript: 'e' };

test('reprise d’une étape (reprise !== null) : contrôleur non appelé, copie existante réutilisée', async () => {
  const { db, deps, appels, controles, copies } = banc([{ verdict: 'ok', note: 'Plan sûr.' }]);
  valider(db);
  definirReprise(db, 'T-41', REPRISE);
  const t = await avancer(deps, 'T-41');
  assert.equal(controles.length, 0, 'pas de contrôle du relais à la reprise');
  assert.deepEqual(copies, ['reprise:T-41', 'supprimee:T-41'], 'copie(…, neuve = false)');
  assert.deepEqual([appels.length, appels[0].volume], [1, 'bureau-t-41-controle']);
  assert.deepEqual([t.etape, t.statut], ['implementation', 'prete']);
});

test('pause d’intégrité : la reprise de session est effacée (jamais de --resume après une anomalie)', async () => {
  const { db, deps, appels } = banc([]);
  valider(db);
  definirReprise(db, 'T-41', REPRISE);
  db.prepare("UPDATE artefacts SET contenu = '# Plan sans zones' WHERE type = 'plan'").run();
  const t = await avancer(deps, 'T-41');
  assert.equal(t.raison?.split(' : ')[0], 'integrite');
  assert.equal(t.reprise, null);
  assert.equal(appels.length, 0);
});

test('pause d’intégrité pendant l’étape : la reprise de session est effacée aussi', async () => {
  const { db, deps } = banc([]);
  valider(db);
  deps.executer = async id => {
    appliquer(db, id, { type: 'demarrage' });
    definirReprise(db, id, REPRISE); // comme lancerEtape lors d'un defer
    throw new AnomalieIntegrite('plan', 'plan altéré pendant l’étape');
  };
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.raison, t.reprise], ['en_pause', 'integrite : plan altéré pendant l’étape', null]);
});

function aEtape(db: ReturnType<typeof ouvrirBase>, etape: 'review' | 'qa', analyse: Analyse = ANALYSE_VERTE) {
  valider(db);
  for (const [type, contenu] of [['resume', 'Export PDF ajouté.'], ['rapport', 'RAS'], ['avis_patron_code', 'Bien.']] as const)
    enregistrerArtefact(db, cle, 'T-41', type, contenu);
  if (etape === 'qa') enregistrerArtefact(db, cle, 'T-41', 'analyse', JSON.stringify(analyse));
  db.prepare("UPDATE taches SET etape = ? WHERE id = 'T-41'").run(etape);
}
const qaGo = { verdict: 'go', criteres: [{ numero: 1, rempli: true, preuve: 'ExportPdf_ContientSynopsis vert' }] };
const COUV_BASSE: Analyse = { ...ANALYSE_VERTE, couverture: { couvertes: 18, total: 25, pourcentage: 72, sourcesHorsCouverture: [] } };

test('review : analyse lancée sur la copie, signée, transmise au reviewer', async () => {
  const { db, deps, appels, analyses } = banc([{ rapport: 'RAS' }]);
  aEtape(db, 'review');
  const t = await avancer(deps, 'T-41');
  assert.equal(t.etape, 'patron_code');
  assert.deepEqual(analyses, [['T-41', 'bureau-t-41-controle', BASE]]);
  assert.equal(JSON.parse(lireArtefact(db, cle, 'T-41', 'analyse')!.contenu).sha, SHA);
  assert.ok(appels[0].prompt.includes('"analyse"'), 'analyse dans les documents du reviewer');
});

test('review : copie neuve analysée, puis copie neuve pour le reviewer, au même SHA que l’analyse', async () => {
  const { db, deps, appels, ordre } = banc([{ rapport: 'RAS' }]);
  aEtape(db, 'review');
  const t = await avancer(deps, 'T-41');
  assert.equal(t.etape, 'patron_code');
  // tester.sh a exécuté le code de l'implémenteur dans la première copie : le reviewer n'y travaille jamais.
  assert.deepEqual(ordre, ['copie:neuve', 'analyse', 'copie:neuve', 'sha', 'agent:reviewer']);
  assert.equal(appels[0].volume, 'bureau-t-41-controle');
});

test('review : copie du reviewer à un autre SHA que l’analyse = pause d’intégrité, aucun agent', async () => {
  const { db, deps, appels } = banc([{ rapport: 'RAS' }], { sha: 'c'.repeat(40) });
  aEtape(db, 'review');
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.etape, t.statut], ['review', 'en_pause']);
  assert.equal(t.raison?.split(' : ')[0], 'integrite');
  assert.equal(appels.length, 0);
  assert.equal(lireJournal(db, 'T-41').at(-1)?.decideur, 'Contrôleur d’intégrité');
});

test('review d’un nouveau cycle : l’analyse du cycle précédent n’est pas transmise au contrôle du relais', async () => {
  const { db, deps, appels, controles } = banc([{ rapport: 'RAS' }]);
  aEtape(db, 'review');
  enregistrerArtefact(db, cle, 'T-41', 'analyse', JSON.stringify({ ...ANALYSE_VERTE, tests: { total: 99, echecs: 3 } }));
  await avancer(deps, 'T-41');
  assert.equal(controles[0].relais, 'Implémentation → Review');
  assert.ok(!('analyse' in controles[0].documents), 'analyse périmée exclue du contrôle');
  const courante = lireArtefact(db, cle, 'T-41', 'analyse')!.contenu;
  assert.equal(JSON.parse(courante).tests.total, 12);
  assert.ok(appels[0].prompt.includes(JSON.stringify(courante).slice(1, -1)) && !appels[0].prompt.includes('99'), 'le reviewer reçoit l’analyse du cycle courant');
});

test('review sans commit de base : étape bloquée, aucun agent', async () => {
  const { db, deps, appels } = banc([], { base: null });
  aEtape(db, 'review');
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.statut, t.raison], ['bloquee', 'commit de base inconnu : tâche créée avant l’analyse']);
  assert.equal(appels.length, 0);
});

test('QA : couverture sous le seuil du projet = no-go avec la règle déclenchée', async () => {
  const { db, deps } = banc([qaGo]);
  aEtape(db, 'qa', COUV_BASSE);
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.etape, t.essaisQa], ['implementation', 1]);
  assert.deepEqual(JSON.parse(lireArtefact(db, cle, 'T-41', 'verdict')!.contenu).regles, ['couverture des lignes modifiées 72 % < 80 %']);
});

test('QA : seuil propre au projet appliqué', async () => {
  const { db, deps } = banc([qaGo]);
  definirSeuils(db, 'Film', { couvertureLignes: 70 });
  aEtape(db, 'qa', COUV_BASSE);
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.etape, t.statut], ['validation', 'attente_humain']);
  assert.deepEqual(JSON.parse(lireArtefact(db, cle, 'T-41', 'verdict')!.contenu).regles, []);
});

test('QA : branche modifiée depuis l’analyse = pause d’intégrité, sans agent', async () => {
  const { db, deps, appels } = banc([qaGo], { sha: 'c'.repeat(40) });
  aEtape(db, 'qa');
  const t = await avancer(deps, 'T-41');
  assert.equal(t.raison?.split(' : ')[0], 'integrite');
  assert.equal(appels.length, 0);
});

test('QA : SHA de la copie illisible alors que celui de l’analyse est valide = pause d’intégrité', async () => {
  const { db, deps, appels } = banc([qaGo], { sha: null });
  aEtape(db, 'qa');
  const t = await avancer(deps, 'T-41');
  assert.equal(t.raison?.split(' : ')[0], 'integrite');
  assert.equal(appels.length, 0);
});

// Dépend de analyse.ts, qui force les mesures statiques à « absent » quand le sha est invalide : les règles donnent no-go.
test('QA : SHA de l’analyse invalide = contrôle ignoré, pas d’anomalie, verdict no-go par les règles', async () => {
  const invalide: Analyse = { ...ANALYSE_VERTE, sha: 'pas-un-sha', outils: { ...ANALYSE_VERTE.outils, semgrep: 'absent', gitleaks: 'absent' } };
  const { db, deps } = banc([qaGo], { sha: null });
  aEtape(db, 'qa', invalide);
  const t = await avancer(deps, 'T-41');
  assert.notEqual(t.statut, 'en_pause');
  assert.equal(JSON.parse(lireArtefact(db, cle, 'T-41', 'verdict')!.contenu).verdict, 'no_go');
  assert.equal(t.etape, 'implementation');
});

test('review en reprise : analyse non relancée, analyse signée conservée', async () => {
  const { db, deps, appels, analyses } = banc([{ rapport: 'RAS' }]);
  aEtape(db, 'review');
  enregistrerArtefact(db, cle, 'T-41', 'analyse', JSON.stringify({ ...ANALYSE_VERTE, tests: { total: 99, echecs: 0 } }));
  const avant = lireArtefact(db, cle, 'T-41', 'analyse')!.sha256;
  definirReprise(db, 'T-41', REPRISE);
  await avancer(deps, 'T-41');
  assert.equal(analyses.length, 0, 'volume déjà modifié par le reviewer : pas de nouvelle mesure');
  assert.equal(lireArtefact(db, cle, 'T-41', 'analyse')!.sha256, avant);
  assert.ok(appels[0].prompt.includes('"analyse"'));
});

test('analyse signée altérée entre la review et le QA : pause d’intégrité, aucun go', async () => {
  const { db, deps, appels } = banc([{ rapport: 'RAS' }, { note: 'Bien.' }, qaGo]);
  aEtape(db, 'review');
  await avancer(deps, 'T-41');
  await avancer(deps, 'T-41');
  assert.equal(lireTache(db, 'T-41').etape, 'qa');
  const falsifiee = JSON.stringify({ ...ANALYSE_VERTE, outils: { ...ANALYSE_VERTE.outils, semgrep: 'ok' }, constats: [] });
  db.prepare("UPDATE artefacts SET contenu = ? WHERE type = 'analyse'").run(falsifiee);
  const t = await avancer(deps, 'T-41');
  assert.deepEqual([t.etape, t.statut], ['qa', 'en_pause']);
  assert.equal(t.raison?.split(' : ')[0], 'integrite');
  assert.deepEqual(appels.map(a => a.agent.nom), ['reviewer', 'patron'], 'QA jamais lancé');
  assert.equal(lireArtefact(db, cle, 'T-41', 'verdict'), undefined, 'aucun verdict, donc aucun go');
});

test('QA : analyse signée illisible ou de forme inattendue = pause d’intégrité', async () => {
  for (const contenu of ['pas du json', '{"sha":"x"}', 'null']) {
    const { db, deps, appels } = banc([qaGo]);
    aEtape(db, 'qa');
    enregistrerArtefact(db, cle, 'T-41', 'analyse', contenu);
    const t = await avancer(deps, 'T-41');
    assert.equal(t.raison?.split(' : ')[0], 'integrite', contenu);
    assert.equal(appels.length, 0);
  }
});
