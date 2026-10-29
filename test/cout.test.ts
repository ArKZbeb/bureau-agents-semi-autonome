import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coutUsd } from '../src/cout.ts';
import { TARIFS } from '../src/config.ts';

test('coût d’un appel Sonnet 5.5', () => {
  assert.equal(coutUsd({ input_tokens: 100, output_tokens: 50 }, 'claude-sonnet-5-5', TARIFS), (100 * 2 + 50 * 10) / 1e6);
});

test('cache facturé 1,25× à l’écriture, 0,1× à la lecture', () => {
  assert.equal(coutUsd({ input_tokens: 0, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000, output_tokens: 0 }, 'claude-opus-5-5', TARIFS), (1250 + 100) * 4 / 1e6);
});

test('modèle inconnu facturé au tarif le plus cher', () => {
  assert.equal(coutUsd({ input_tokens: 1e6 }, 'modele-inconnu', TARIFS), 4);
});
