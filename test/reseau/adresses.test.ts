import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adressesConteneurs } from '../../src/reseau/adresses.ts';

test('toujours 127.0.0.1, plus la passerelle du pont si elle est privée', () => {
  assert.deepEqual(adressesConteneurs(null), ['127.0.0.1']);
  assert.deepEqual(adressesConteneurs('172.17.0.1'), ['127.0.0.1', '172.17.0.1']);
  assert.deepEqual(adressesConteneurs('10.1.2.3'), ['127.0.0.1', '10.1.2.3']);
  assert.deepEqual(adressesConteneurs('192.168.65.1'), ['127.0.0.1', '192.168.65.1']);
  assert.deepEqual(adressesConteneurs('172.31.255.254'), ['127.0.0.1', '172.31.255.254']);
});

test('0.0.0.0, adresses publiques, hors plage ou invalides : ignorées', () => {
  for (const a of ['0.0.0.0', '::', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '256.1.1.1', '172.17.0.1/16', 'localhost', '', ' 172.17.0.1', '172.17.0.01', '127.0.0.1'])
    assert.deepEqual(adressesConteneurs(a), ['127.0.0.1'], a);
});

test('la surcharge est validée comme la passerelle et la remplace', () => {
  assert.deepEqual(adressesConteneurs('172.17.0.1', '192.168.1.5'), ['127.0.0.1', '192.168.1.5']);
  assert.deepEqual(adressesConteneurs('172.17.0.1', '0.0.0.0'), ['127.0.0.1']);
  assert.deepEqual(adressesConteneurs(null, '8.8.8.8'), ['127.0.0.1']);
});
