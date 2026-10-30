import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chargerPanneau } from '../../src/reseau/panneau.ts';

function construit(fichiers: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'panneau-'));
  for (const [f, c] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
}

test('charge les fichiers connus avec leur type', () => {
  const p = chargerPanneau(construit({ 'index.html': '<html>', 'main-AB12.js': 'x', 'styles-CD34.css': 'y', 'media/logo.svg': '<svg/>', 'notes.exe': 'z' }))!;
  assert.deepEqual([...p.keys()].sort(), ['/index.html', '/main-AB12.js', '/media/logo.svg', '/styles-CD34.css']);
  assert.equal(p.get('/index.html')!.type, 'text/html; charset=utf-8');
  assert.equal(p.get('/main-AB12.js')!.type, 'text/javascript; charset=utf-8');
});

test('panneau absent sans index.html', () => {
  assert.equal(chargerPanneau(construit({ 'main.js': 'x' })), null);
  assert.equal(chargerPanneau('/n/existe/pas'), null);
});

test('liens symboliques ignorés', () => {
  const d = construit({ 'index.html': '<html>' });
  fs.symlinkSync('/etc/hostname', path.join(d, 'fuite.txt'));
  assert.equal(chargerPanneau(d)!.has('/fuite.txt'), false);
});
