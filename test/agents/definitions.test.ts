import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chargerConfig } from '../../src/config.ts';
import { agentPour, DEFINITIONS, lireSortie, SortieCadreur, SortieQa, type EtapeAgent } from '../../src/agents/definitions.ts';

const config = chargerConfig({});
const socle = fs.readFileSync('agents/socle.md', 'utf8');

test('chaque étape a un agent, un prompt avec le socle et un schéma objet', () => {
  for (const etape of Object.keys(DEFINITIONS) as EtapeAgent[]) {
    const a = agentPour(etape, config, process.cwd());
    assert.ok(a.promptSysteme.startsWith(socle), `${etape} : socle en tête`);
    assert.ok(a.promptSysteme.length > socle.length + 200, `${etape} : rôle présent`);
    assert.equal((a.schema as { type: string }).type, 'object', `${etape} : schéma objet`);
  }
});

test('modèles, durées et espaces de la spec', () => {
  assert.equal(agentPour('implementation', config, process.cwd()).modele, 'claude-sonnet-5-5');
  assert.equal(agentPour('qa', config, process.cwd()).modele, 'claude-opus-5-5');
  assert.equal(agentPour('implementation', config, process.cwd()).dureeMaxMs, 60 * 60_000);
  assert.equal(DEFINITIONS.implementation.espace, 'branche');
  assert.equal(DEFINITIONS.cadrage.espace, 'branche');
  for (const e of ['patron_plan', 'review', 'patron_code', 'qa'] as const) assert.equal(DEFINITIONS[e].espace, 'copie');
});

test('sortie du cadreur : questions non vides ou proposition, sinon illisible', () => {
  assert.deepEqual(lireSortie(SortieCadreur, { type: 'questions', questions: ['Remises incluses ?'] }), { type: 'questions', questions: ['Remises incluses ?'] });
  assert.deepEqual(lireSortie(SortieCadreur, { type: 'proposition' }), { type: 'proposition' });
  assert.equal(lireSortie(SortieCadreur, { type: 'questions', questions: [] }), null);
  assert.equal(lireSortie(SortieCadreur, { type: 'peut-être' }), null);
  assert.equal(lireSortie(SortieCadreur, null), null);
});

test('sortie du QA : verdict et preuve par critère', () => {
  const v = { verdict: 'go', criteres: [{ numero: 1, rempli: true, preuve: 'test ExportPdf_ContientSynopsis vert' }] };
  assert.deepEqual(lireSortie(SortieQa, v), v);
  assert.equal(lireSortie(SortieQa, { verdict: 'peut-être', criteres: [] }), null);
});
