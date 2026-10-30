import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { chargerConfig } from '../src/config.ts';
import { chargerOuCreerCle } from '../src/integrite/cle.ts';
import { ecrireManifeste } from '../src/integrite/manifeste.ts';
import { lireJournal, verifierJournal } from '../src/integrite/journal.ts';
import { lireArtefact, type TypeArtefact } from '../src/integrite/artefacts.ts';
import { construireImage } from '../src/conteneurs/image.ts';
import { brancheTache, lireFichierVolume, nomRessource, RACINE_PROJET } from '../src/conteneurs/docker.ts';
import { demarrerOrchestrateur, type Orchestrateur } from '../src/orchestrateur.ts';
import { appliquer, lireTache } from '../src/taches/depot.ts';
import type { ClientAvis } from '../src/gardien/avis.ts';
import { demarrerFausseApi, type FausseApi, type Tour } from '../test/outils/fausse-api.ts';

const docker = new Docker();
const RACINE_DEPOT = process.cwd();
const CLE_SECRETE = 'cle-factice-de-test-ne-doit-jamais-entrer-dans-un-conteneur';
const T = 'T-950';
const ecrire = (file_path: string, content: string): Tour => ({ outil: { nom: 'Write', entree: { file_path, content } } });
const bash = (command: string, description: string): Tour => ({ outil: { nom: 'Bash', entree: { command, description } } });

// Ordre des requêtes avec outils : cadreur, patron (plan), implémenteur, reviewer, patron (code), QA.
const tours: Tour[] = [
  { sortie: { type: 'questions', questions: ['Format A4 ?'] } },
  ecrire('/workspace/cadrage/spec.md', '# Spec\n\nExport PDF.\n\n## Critères d’acceptation\n\n1. Le fichier src/export.js existe\n'),
  ecrire('/workspace/cadrage/plan.md', '# Plan\n\n## Zones touchées\n\n- `src/**`\n'),
  ecrire(`${RACINE_PROJET}/src/cadreur.js`, 'x'),
  bash('mkdir -p src && echo x > src/cadreur-shell.js', 'écriture par le shell'),
  { sortie: { type: 'proposition' } },
  { sortie: { verdict: 'ok', note: 'Plan sûr.' } },
  ecrire(`${RACINE_PROJET}/src/export.js`, 'export const exporter = () => "pdf";\n'),
  bash('git add src/export.js && git commit -m "feat: export PDF"', 'commit'),
  { sortie: { resume: 'src/export.js ajouté et commité.' } },
  ecrire(`${RACINE_PROJET}/src/piege.js`, 'x'),
  { sortie: { rapport: 'RAS.' } },
  { sortie: { note: 'Bien.' } },
  bash('ls src', 'vérification'),
  { sortie: { verdict: 'go', criteres: [{ numero: 1, rempli: true, preuve: 'ls src : export.js' }] } },
];

let image: string;
let o: Orchestrateur;
let api: FausseApi;
let cle: Buffer;
let tacheApi: string | undefined;
const dossiersTemporaires: string[] = [];

function depotPiege(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-piege-'));
  fs.cpSync(path.join(RACINE_DEPOT, 'test/fixtures/repo-piege'), d, { recursive: true });
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: d });
  return d;
}

const attendre = async () => { while (o.ordonnanceur.enVol().length) await new Promise(r => setTimeout(r, 200)); };
const tourComplet = async () => { await o.ordonnanceur.tour(); await attendre(); };
const etat = () => { const t = lireTache(o.db, T); return `${t.etape}/${t.statut}/${t.raison ?? ''}`; };
const poster = async (route: string, corps: object) => {
  const r = await fetch(`${o.urlUi}/api/taches/${T}/${route}`, {
    method: 'POST', headers: { authorization: `Bearer ${o.jetonSession}`, 'content-type': 'application/json' }, body: JSON.stringify(corps),
  });
  assert.equal(r.status, 200, await r.clone().text());
};

describe('Parcours complet d’une story avec des agents simulés', () => {
  before(async () => {
    image = construireImage(RACINE_DEPOT);
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-donnees-'));
    cle = chargerOuCreerCle(dossier);
    ecrireManifeste(dossier, cle, RACINE_DEPOT, image);
    api = await demarrerFausseApi(tours);
    const clientAvis = {
      messages: {
        parse: async (p: { system: string }) => {
          const controleur = String(p.system).includes('Contrôleur d\'intégrité');
          return {
            parsed_output: controleur ? { verdict: 'ok', constats: [] } : { decision: 'autoriser', raison: 'conforme au plan' },
            stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    } as unknown as ClientAvis;
    const config = { ...chargerConfig({ BUREAU_DONNEES: dossier }), portUi: 47320, portConteneurs: 47321, urlApiAmont: api.url, cleApi: CLE_SECRETE, delaiGardienMs: 5_000 };
    o = await demarrerOrchestrateur({ config, racineDepot: RACINE_DEPOT, docker, clientAvis });
    await o.ordonnanceur.arreter(); // le test pilote les tours lui-même
    await o.creerTache({ id: T, projet: 'Film', titre: 'Export PDF de la fiche film', cheminProjet: depotPiege(), budgetUsd: 20, demande: 'Exporter la fiche film en PDF' });
  });
  after(async () => {
    await o?.arreter();
    await api?.fermer();
    await docker.getVolume(nomRessource(T)).remove({ force: true }).catch(() => {});
    await docker.getVolume(`${nomRessource(T)}-controle`).remove({ force: true }).catch(() => {});
    if (tacheApi) await docker.getVolume(nomRessource(tacheApi)).remove({ force: true }).catch(() => {});
    for (const d of dossiersTemporaires) fs.rmSync(d, { recursive: true, force: true });
  });

  test('cadrage, validation, implémentation, review, patron, QA jusqu’à ma validation', async () => {
    await tourComplet();
    assert.equal(etat(), 'cadrage/attente_humain/le cadreur attend ta réponse');

    await poster('reponse', { texte: 'Oui, A4.' });
    for (let i = 0; i < 3 && lireTache(o.db, T).raison !== 'spec et plan à valider'; i++) await tourComplet();
    assert.equal(etat(), 'cadrage/attente_humain/spec et plan à valider');

    await poster('validation-cadrage', {});
    for (let i = 0; i < 12 && lireTache(o.db, T).etape !== 'validation'; i++) await tourComplet();
    assert.equal(etat().split('/').slice(0, 2).join('/'), 'validation/attente_humain');

    const export_ = await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/src/export.js`);
    assert.match(export_ ?? '', /exporter/);
    assert.equal(await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/src/piege.js`), null, 'le reviewer n’a rien écrit');
    assert.equal(await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/src/cadreur.js`), null, 'le cadreur n’a rien écrit hors spec et plan');
    // Le cadreur travaille sur la copie de contrôle : même une écriture par le shell n'atteint pas la branche.
    assert.equal(await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/src/cadreur-shell.js`), null, 'le shell du cadreur n’atteint pas la branche');
    assert.equal(await lireFichierVolume(docker, image, nomRessource(T), '/workspace/cadrage/spec.md'), null, 'spec.md écrit dans la copie, pas dans l’espace de la branche');

    const journal = lireJournal(o.db, T);
    assert.ok(journal.some(e => e.type === 'decision' && e.commande.includes('src/piege.js') && e.decision === 'Refusé' && e.decideur === 'Liste noire' && e.raison.includes('agent en lecture seule : Write et Edit retirés')));
    assert.ok(journal.some(e => e.type === 'decision' && e.commande.includes('src/cadreur.js') && e.decision === 'Refusé' && e.raison.includes('le cadreur n’écrit que spec.md et plan.md')));

    assert.ok(journal.some(e => e.type === 'decision' && e.commande.startsWith('git add src/export.js && git commit') && e.decision === 'Autorisé'), 'commit autorisé par le gardien');
    const ref = await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/.git/refs/heads/${brancheTache(T)}`);
    assert.match(ref ?? '', /^[0-9a-f]{40}\n?$/, 'la branche de la tâche porte un commit');
    assert.match(lireArtefact(o.db, cle, T, 'spec')?.contenu ?? '', /Critères d’acceptation/);
    assert.equal(lireArtefact(o.db, cle, T, 'criteres')?.contenu, '1. Le fichier src/export.js existe\n');
    const types: TypeArtefact[] = ['spec', 'criteres', 'plan', 'avis_patron', 'resume', 'rapport', 'avis_patron_code', 'analyse', 'verdict'];
    for (const type of types) assert.ok(lireArtefact(o.db, cle, T, type), `${type} lisible et signé`);

    // Dépôt piège sans .NET ni Angular : tests, audits et couverture non applicables, Semgrep et gitleaks ont tourné.
    const analyse = JSON.parse(lireArtefact(o.db, cle, T, 'analyse')?.contenu ?? 'null');
    assert.deepEqual(analyse.outils, {
      tests_dotnet: 'non_applicable', audit_dotnet: 'non_applicable', tests_angular: 'non_applicable',
      audit_npm: 'non_applicable', semgrep: 'ok', gitleaks: 'ok', couverture: 'non_applicable',
    });
    assert.deepEqual(JSON.parse(lireArtefact(o.db, cle, T, 'verdict')?.contenu ?? 'null').regles, [], 'aucune règle QA déclenchée');
    const mesuresAnalyse = journal.filter(e => e.raison.startsWith('analyse de review'));
    assert.equal(mesuresAnalyse.length, 7, 'une entrée de journal par outil, couverture comprise');

    const volumes = (await docker.listVolumes()).Volumes ?? [];
    assert.ok(!volumes.some(v => v.Name.startsWith(nomRessource(T)) && v.Name.endsWith('-controle')), 'aucune copie de contrôle ne subsiste');
    verifierJournal(o.db, cle);
    // La fausse API est en amont du proxy : la clé n'y arrive que ajoutée par le proxy, jamais fournie par un conteneur.
    assert.ok(api.requetes.length > 0 && api.requetes.every(r => r.cleApi === CLE_SECRETE), 'clé ajoutée par le proxy de l’orchestrateur');
  });

  // Placé après le parcours : l'arrêt global ne doit pas le perturber (la tâche attend alors ma validation).
  test('API du panneau : projet non relié, état global, intégrité du journal', async () => {
    const appel = async (chemin: string, methode = 'GET', corps?: object) => {
      const r = await fetch(`${o.urlUi}${chemin}`, {
        method: methode, headers: { authorization: `Bearer ${o.jetonSession}`, 'content-type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined,
      });
      return { statut: r.status, corps: await r.json() as Record<string, unknown> };
    };
    const avant = (o.db.prepare('SELECT COUNT(*) AS n FROM taches').get() as { n: number }).n;
    assert.deepEqual(await appel('/api/taches', 'POST', { projet: 'Inconnu', titre: 'x', demande: 'y' }), { statut: 409, corps: { erreur: 'projet non relié : Inconnu' } });
    assert.equal((o.db.prepare('SELECT COUNT(*) AS n FROM taches').get() as { n: number }).n, avant, 'aucune tâche créée');

    assert.deepEqual((await appel('/api/etat')).corps, { ordonnanceur: 'actif' });
    await appel('/api/arret-global', 'POST');
    assert.deepEqual((await appel('/api/etat')).corps, { ordonnanceur: 'suspendu' });
    await appel('/api/reprise-globale', 'POST');
    assert.deepEqual((await appel('/api/etat')).corps, { ordonnanceur: 'actif' });

    const integrite = (await appel('/api/journal/integrite')).corps;
    assert.equal(integrite.intacte, true);
    assert.ok((integrite.entrees as number) > 0);
  });

  test('API du panneau : une tâche créée sur un projet relié prend chemin et budget du projet, jamais du corps', async () => {
    const appel = async (chemin: string, corps: object) => {
      const r = await fetch(`${o.urlUi}${chemin}`, {
        method: 'POST', headers: { authorization: `Bearer ${o.jetonSession}`, 'content-type': 'application/json' }, body: JSON.stringify(corps),
      });
      return { statut: r.status, corps: await r.json() as Record<string, unknown> };
    };
    const depot = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-projet-dotnet-'));
    dossiersTemporaires.push(depot);
    fs.cpSync(path.join(RACINE_DEPOT, 'test/fixtures/projet-dotnet'), depot, { recursive: true });
    for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: depot });
    const canonique = fs.realpathSync(depot);

    const relie = await appel('/api/projets', { nom: 'Film API', chemin: depot, budgetUsd: 7.5, couvertureLignes: 70 });
    assert.equal(relie.statut, 200, JSON.stringify(relie.corps));

    const cree = await appel('/api/taches', { projet: 'Film API', titre: 'Export CSV', demande: 'Exporter en CSV', cheminProjet: '/etc', budgetUsd: 1e6, id: 'T-1' });
    assert.equal(cree.statut, 200, JSON.stringify(cree.corps));
    tacheApi = String(cree.corps.id);
    assert.notEqual(tacheApi, 'T-1');
    const t = lireTache(o.db, tacheApi);
    assert.equal(t.projet, 'Film API');
    assert.equal(t.cheminProjet, canonique);
    assert.equal(t.budgetUsd, 7.5);
    assert.equal(t.statut, 'prete');
    assert.equal(cree.corps.cheminProjet, canonique);
    assert.equal(cree.corps.budgetUsd, 7.5);
    assert.equal(lireArtefact(o.db, cle, tacheApi, 'demande')?.contenu, 'Exporter en CSV');

    // L'ordonnanceur est arrêté dans ce fichier : la tâche n'a jamais tourné ; elle est abandonnée, son espace retiré en fin de fichier.
    appliquer(o.db, tacheApi, { type: 'abandon' });
  });
});
