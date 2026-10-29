import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const s = JSON.parse(fs.readFileSync('conteneur/managed-settings.json', 'utf8'));

test('règles de permission et hooks réservés aux managed settings', () => {
  assert.equal(s.allowManagedPermissionRulesOnly, true);
  assert.equal(s.allowManagedHooksOnly, true);
  assert.equal(s.permissions.disableBypassPermissionsMode, 'disable');
});

test('aucune règle allow : une sortie de hook sans décision retombe sur un refus', () => {
  assert.equal(s.permissions.allow, undefined);
});

test('hook gardien sur tous les outils, bloquant en cas d’échec', () => {
  const [entree] = s.hooks.PreToolUse;
  assert.equal(entree.matcher, '*');
  assert.deepEqual(entree.hooks, [{ type: 'command', command: 'node /opt/hooks/hook-gardien.mjs', timeout: 90, onFailure: 'block' }]);
});
