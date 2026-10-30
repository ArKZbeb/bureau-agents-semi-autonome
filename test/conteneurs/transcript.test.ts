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
import { sha256 } from '../../src/integrite/signature.ts';
import { Jetons } from '../../src/reseau/jetons.ts';
import { PLAFOND_LECTURE } from '../../src/conteneurs/docker.ts';
import { lancerEtape, type DepsExecution } from '../../src/conteneurs/execution.ts';
import { creerTache, definirReprise, lireTache } from '../../src/taches/depot.ts';

const T = 'T-78';
const IMAGE = `sha256:${'a'.repeat(64)}`;
const AGENT = { nom: 'qa', modele: 'm', maxTours: 1, dureeMaxMs: 1000, promptSysteme: '' };

const trame = (contenu: Buffer) => {
  const entete = Buffer.alloc(8);
  entete[0] = 1;
  entete.writeUInt32BE(contenu.length, 4);
  return Buffer.concat([entete, contenu]);
};

/** Docker minimal : la lecture jetable du transcript rend `transcript` ; tout autre conteneur est compté. */
function deps(transcript: Buffer | null) {
  const agents: string[][] = [];
  const docker = {
    getImage: () => ({ inspect: async () => ({ Id: IMAGE }) }),
    createContainer: async (o: Docker.ContainerCreateOptions) => {
      const cmd = o.Cmd as string[];
      if (cmd[0] !== 'sh') { agents.push(cmd); throw new Error('aucun conteneur d’agent attendu'); }
      const limite = Number(cmd.at(-1));
      return {
        start: async () => {}, remove: async () => {},
        wait: async () => ({ StatusCode: transcript === null ? 3 : 0 }),
        logs: async () => (transcript === null ? Buffer.alloc(0) : trame(transcript.subarray(0, limite))),
      };
    },
  };
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-transcript-'));
  const cle = chargerOuCreerCle(dossier);
  ecrireManifeste(dossier, cle, process.cwd(), IMAGE);
  const db = ouvrirBase(':memory:');
  creerTache(db, { id: T, projet: 'Film', titre: 't', cheminProjet: '/p', budgetUsd: 5 });
  const d: DepsExecution = {
    docker: docker as unknown as Docker, db, cle, jetons: new Jetons(), evenements: new EventEmitter(), racineDepot: process.cwd(),
    enCours: new Map(), config: chargerConfig({ BUREAU_DONNEES: dossier }),
  };
  return { d, agents };
}

test('reprise : transcript au-delà du plafond (illisible) = pause d’intégrité, jamais comparé comme vide', async () => {
  // Empreinte prise sur une lecture illisible (sha256 de ''), comme lors de la mise en pause d'une longue session.
  const { d, agents } = deps(Buffer.alloc(PLAFOND_LECTURE + 1, 'x'));
  definirReprise(d.db, T, { sessionId: 's1', mode: 'defer', message: null, empreinteTranscript: sha256('') });
  const r = await lancerEtape(d, T, AGENT, 'p');
  assert.deepEqual(r, { issue: 'pause', raison: 'integrite' });
  const t = lireTache(d.db, T);
  assert.match(t.raison ?? '', /transcript de session illisible/);
  assert.equal(t.reprise, null);
  assert.equal(agents.length, 0, 'aucun agent lancé');
});

test('reprise : transcript absent = pause d’intégrité', async () => {
  const { d, agents } = deps(null);
  definirReprise(d.db, T, { sessionId: 's1', mode: 'defer', message: null, empreinteTranscript: sha256('') });
  assert.deepEqual(await lancerEtape(d, T, AGENT, 'p'), { issue: 'pause', raison: 'integrite' });
  assert.equal(agents.length, 0);
});
