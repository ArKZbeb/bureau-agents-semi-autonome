import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type Docker from 'dockerode';
import { chargerConfig } from '../../src/config.ts';
import { ouvrirBase } from '../../src/db.ts';
import { chargerOuCreerCle } from '../../src/integrite/cle.ts';
import { ecrireManifeste } from '../../src/integrite/manifeste.ts';
import { lireJournal } from '../../src/integrite/journal.ts';
import { Jetons } from '../../src/reseau/jetons.ts';
import { creerTache } from '../../src/taches/depot.ts';
import { pauserPourArretGlobal } from '../../src/pipeline/actions.ts';
import { executerAnalyse } from '../../src/analyse/execution.ts';
import { PLAFOND_ANALYSE } from '../../src/conteneurs/docker.ts';
import type { DepsExecution } from '../../src/conteneurs/execution.ts';

const T = 'T-77';
const IMAGE = `sha256:${'a'.repeat(64)}`;
const BASE = 'b'.repeat(40);
const MESURER = '/opt/analyse/mesurer.sh';
const TESTER = '/opt/analyse/tester.sh';

class JetonsEspion extends Jetons {
  revoques: string[] = [];
  override revoquer(tacheId: string): void { this.revoques.push(tacheId); super.revoquer(tacheId); }
}

type Options = {
  /** Fin du processus principal d'un conteneur d'analyse (mesurer.sh ou tester.sh). */
  attente?: (cmd: string[]) => Promise<{ StatusCode: number }>;
  creation?: (cmd: string[]) => void;
  reseauLeve?: boolean;
};

/** Docker minimal en mémoire : conteneurs d'analyse pilotés par le test, lectures jetables qui ne trouvent rien. */
function fauxDocker(o: Options = {}) {
  const etat = {
    crees: [] as Docker.ContainerCreateOptions[], supprimes: new Set<string>(), volumesSupprimes: [] as string[],
    reseauxSupprimes: 0, lecturesEnCours: 0, lecturesMax: 0,
  };
  let n = 0;
  const docker = {
    getImage: () => ({ inspect: async () => ({ Id: IMAGE }) }),
    listNetworks: async () => [],
    createNetwork: async () => ({}),
    getNetwork: () => ({
      inspect: async () => ({ Internal: true }), connect: async () => {}, disconnect: async () => {},
      remove: async () => { if (o.reseauLeve) throw new Error('suppression du réseau impossible'); etat.reseauxSupprimes++; },
    }),
    getVolume: (nom: string) => ({ inspect: async () => ({}), remove: async () => { etat.volumesSupprimes.push(nom); } }),
    createVolume: async () => ({}),
    createContainer: async (opts: Docker.ContainerCreateOptions) => {
      const id = `c${++n}`;
      const cmd = opts.Cmd as string[];
      o.creation?.(cmd);
      etat.crees.push(opts);
      const lecture = cmd[0] === 'sh';
      return {
        id,
        start: async () => { if (lecture) etat.lecturesMax = Math.max(etat.lecturesMax, ++etat.lecturesEnCours); },
        wait: async () => {
          if (!lecture) return (o.attente ?? (async () => ({ StatusCode: 0 })))(cmd);
          await new Promise(r => setTimeout(r, 5));
          etat.lecturesEnCours--;
          return { StatusCode: 3 };
        },
        logs: async () => Buffer.alloc(0),
        remove: async () => { etat.supprimes.add(id); },
      };
    },
  };
  return { docker: docker as unknown as Docker, etat };
}

function deps(docker: Docker, delaiAnalyseMs = 60_000): DepsExecution {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-analyse-'));
  const cle = chargerOuCreerCle(dossier);
  ecrireManifeste(dossier, cle, process.cwd(), IMAGE);
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: T, projet: 'Film', titre: 't', cheminProjet: '/p', budgetUsd: 5 });
  return {
    docker, db, cle, jetons: new JetonsEspion(), evenements: new EventEmitter(), racineDepot: process.cwd(), enCours: new Map(),
    config: { ...chargerConfig({ BUREAU_DONNEES: dossier }), delaiAnalyseMs },
  };
}

const analyses = (crees: Docker.ContainerCreateOptions[]) => crees.filter(c => (c.Cmd as string[])[0] !== 'sh');
const jetonDe = (c: Docker.ContainerCreateOptions) => /^HTTPS_PROXY=http:\/\/tache:([^@]+)@/.exec((c.Env ?? []).find(e => e.startsWith('HTTPS_PROXY=')) ?? '')?.[1];
const raisons = (d: DepsExecution) => lireJournal(d.db, T).map(e => e.raison);

test('arrêt global pendant les mesures : conteneur de tests jamais créé, erreur, nettoyage', async () => {
  let d!: DepsExecution;
  const { docker, etat } = fauxDocker({ attente: async () => { pauserPourArretGlobal(d.db); return { StatusCode: 137 }; } });
  d = deps(docker);
  await assert.rejects(executerAnalyse(d, T, 'copie', BASE), /analyse interrompue : tâche en_pause/);
  assert.deepEqual(analyses(etat.crees).map(c => (c.Cmd as string[])[0]), [MESURER], 'tester.sh jamais lancé');
  assert.ok(etat.crees.every((_, i) => etat.supprimes.has(`c${i + 1}`)), 'conteneurs supprimés');
  assert.deepEqual(etat.volumesSupprimes.filter(v => v.endsWith('-mesures')).length, 2, 'volume des mesures recréé puis supprimé');
  assert.equal(etat.reseauxSupprimes, 1);
  assert.equal(d.jetons.valider(jetonDe(etat.crees[0])), null, 'jeton révoqué');
});

test('tâche passée en pause pendant le démarrage d’un conteneur : supprimé aussitôt, erreur', async () => {
  let d!: DepsExecution;
  const { docker, etat } = fauxDocker({ creation: cmd => { if (cmd[0] === MESURER) pauserPourArretGlobal(d.db); } });
  d = deps(docker);
  await assert.rejects(executerAnalyse(d, T, 'copie', BASE), /analyse interrompue : tâche en_pause/);
  assert.equal(analyses(etat.crees).length, 1);
  assert.ok(etat.supprimes.has('c1'), 'conteneur démarré puis supprimé');
});

test('tâche déjà en pause : aucun conteneur d’analyse', async () => {
  const { docker, etat } = fauxDocker();
  const d = deps(docker);
  pauserPourArretGlobal(d.db);
  await assert.rejects(executerAnalyse(d, T, 'copie', BASE), /analyse interrompue : tâche en_pause/);
  assert.equal(analyses(etat.crees).length, 0);
});

test('délai dépassé pendant les mesures : tests non lancés, outils absents, journalisé', async () => {
  const { docker, etat } = fauxDocker({ attente: () => new Promise(() => {}) });
  const d = deps(docker, 50);
  const a = await executerAnalyse(d, T, 'copie', BASE);
  assert.deepEqual(analyses(etat.crees).map(c => (c.Cmd as string[])[0]), [MESURER]);
  assert.ok(etat.supprimes.has('c1'));
  for (const o of ['tests_dotnet', 'audit_dotnet', 'tests_angular', 'audit_npm', 'semgrep', 'gitleaks', 'couverture'] as const) assert.equal(a.outils[o], 'absent', o);
  const e = lireJournal(d.db, T).find(x => x.raison === 'analyse : délai dépassé');
  assert.ok(e && e.decideur === 'Orchestrateur' && e.type === 'evenement', 'délai journalisé');
  assert.equal(raisons(d).filter(r => r.startsWith('analyse de review')).length, 7);
});

test('attente du conteneur impossible : journalisée, tests non lancés', async () => {
  const { docker, etat } = fauxDocker({ attente: async () => { throw new Error('wait perdu'); } });
  const d = deps(docker);
  const a = await executerAnalyse(d, T, 'copie', BASE);
  assert.ok(raisons(d).includes('analyse : attente du conteneur impossible'));
  assert.deepEqual(analyses(etat.crees).map(c => (c.Cmd as string[])[0]), [MESURER]);
  assert.equal(a.outils.semgrep, 'absent');
});

test('conteneurs d’analyse : montages séparés, jeton de sortie seulement, aucune variable ANTHROPIC_', async () => {
  let d!: DepsExecution;
  const pendant: (string | null)[] = [];
  const { docker, etat } = fauxDocker({
    attente: async cmd => {
      const jeton = jetonDe(etat.crees.find(c => (c.Cmd as string[])[0] === cmd[0])!);
      pendant.push(d.jetons.valider(jeton), d.jetons.valider(jeton, 'agent'));
      return { StatusCode: 0 };
    },
  });
  d = deps(docker);
  await executerAnalyse(d, T, 'copie', BASE);
  const [mesures, tests] = analyses(etat.crees);
  assert.deepEqual((mesures.Cmd as string[]), [MESURER, BASE]);
  assert.deepEqual(mesures.HostConfig?.Mounts, [
    { Type: 'volume', Source: 'copie', Target: '/workspace', ReadOnly: true },
    { Type: 'volume', Source: 'bureau-t-77-mesures', Target: '/mesures' },
  ]);
  assert.deepEqual((tests.Cmd as string[]), [TESTER]);
  assert.deepEqual(tests.HostConfig?.Mounts, [{ Type: 'volume', Source: 'copie', Target: '/workspace' }]);
  for (const c of [mesures, tests]) {
    assert.ok(!(c.Env ?? []).some(e => e.startsWith('ANTHROPIC_') || e.startsWith('BUREAU_JETON')), JSON.stringify(c.Env));
    assert.ok((c.Env ?? []).some(e => e.startsWith('HTTPS_PROXY=http://tache:')));
  }
  assert.deepEqual(pendant, [T, null, T, null], 'jeton valide pour la sortie, refusé là où la portée agent est exigée');
  assert.ok(etat.lecturesMax >= 2 && etat.lecturesMax <= 4, `lectures simultanées : ${etat.lecturesMax}`);
});

test('nettoyage indépendant : volume des mesures supprimé et jeton révoqué malgré l’échec du réseau, erreur d’origine gardée', async () => {
  const { docker, etat } = fauxDocker({ reseauLeve: true, creation: cmd => { if (cmd[0] === MESURER) throw new Error('création impossible'); } });
  const d = deps(docker);
  await assert.rejects(executerAnalyse(d, T, 'copie', BASE), /création impossible/);
  assert.equal(etat.volumesSupprimes.filter(v => v.endsWith('-mesures')).length, 2, 'volume des mesures supprimé');
  assert.deepEqual((d.jetons as JetonsEspion).revoques, [T], 'jeton révoqué');
});

test('échec du nettoyage seul : l’erreur remonte après le nettoyage complet', async () => {
  const { docker, etat } = fauxDocker({ reseauLeve: true });
  const d = deps(docker);
  await assert.rejects(executerAnalyse(d, T, 'copie', BASE), /suppression du réseau impossible/);
  assert.equal(etat.volumesSupprimes.filter(v => v.endsWith('-mesures')).length, 2);
  assert.equal(d.jetons.valider(jetonDe(analyses(etat.crees)[0])), null, 'jeton révoqué');
});

test('fichiers d’analyse relus avec le plafond d’analyse (64 Mo), jamais tronqués à 5 Mo', async () => {
  const { docker, etat } = fauxDocker();
  await executerAnalyse(deps(docker), T, 'copie', BASE);
  const lectures = etat.crees.filter(c => (c.Cmd as string[])[0] === 'sh');
  assert.ok(lectures.length > 0);
  for (const c of lectures) assert.equal((c.Cmd as string[]).at(-1), String(PLAFOND_ANALYSE + 1), JSON.stringify(c.Cmd));
});
