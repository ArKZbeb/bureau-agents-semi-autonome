import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256, hmac, hmacValide } from '../../src/integrite/signature.ts';
import { chargerOuCreerCle } from '../../src/integrite/cle.ts';
import { AnomalieIntegrite } from '../../src/integrite/anomalie.ts';

const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-'));

test('sha256 de référence', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('hmac vérifié, altération détectée', () => {
  const cle = Buffer.alloc(32, 7);
  const s = hmac(cle, 'plan validé');
  assert.ok(hmacValide(cle, 'plan validé', s));
  assert.ok(!hmacValide(cle, 'plan modifié', s));
  assert.ok(!hmacValide(Buffer.alloc(32, 8), 'plan validé', s));
  assert.ok(!hmacValide(cle, 'plan validé', 'abcd'));
});

test('clé créée une fois puis relue à l’identique', () => {
  const d = dossier();
  const a = chargerOuCreerCle(d);
  assert.equal(a.length, 32);
  assert.deepEqual(chargerOuCreerCle(d), a);
});

test('clé tronquée = anomalie', () => {
  const d = dossier();
  fs.writeFileSync(path.join(d, 'cle-hmac'), Buffer.alloc(10));
  assert.throws(() => chargerOuCreerCle(d), AnomalieIntegrite);
});
