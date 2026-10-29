import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Docker from 'dockerode';
import { demarrerOrchestrateur } from '../src/orchestrateur.ts';
import { chargerConfig } from '../src/config.ts';
import { MESSAGE_SANS_DOCKER } from '../src/conteneurs/docker.ts';

const config = () => chargerConfig({ BUREAU_DONNEES: fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-')) });

test('Docker absent : message explicite de la maquette', async () => {
  const docker = { ping: () => Promise.reject(new Error('connect ENOENT //./pipe/docker_engine')) } as unknown as Docker;
  await assert.rejects(demarrerOrchestrateur({ config: config(), racineDepot: process.cwd(), docker }), { message: MESSAGE_SANS_DOCKER });
});

test('manifeste absent : démarrage refusé', async () => {
  const docker = { ping: async () => 'OK' } as unknown as Docker;
  await assert.rejects(demarrerOrchestrateur({ config: config(), racineDepot: process.cwd(), docker }), /manifeste absent/);
});
