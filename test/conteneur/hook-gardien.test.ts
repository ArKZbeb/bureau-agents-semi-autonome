import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type net from 'node:net';
import { spawn } from 'node:child_process';

const ENTREE = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, tool_use_id: 'toolu_1' });

function lancerHook(url: string): Promise<{ code: number | null; sortie: string }> {
  return new Promise(ok => {
    const p = spawn(process.execPath, ['conteneur/hook-gardien.mjs'], { env: { ...process.env, BUREAU_URL_GARDIEN: url, BUREAU_JETON: 'jeton-t41' } });
    let sortie = '';
    p.stdout.on('data', d => (sortie += d));
    p.on('close', code => ok({ code, sortie }));
    p.stdin.end(ENTREE);
  });
}

async function gardienFactice(reponse: (corps: string, auth: string | undefined) => [number, string]) {
  const s = http.createServer((req, res) => {
    let corps = '';
    req.on('data', d => (corps += d));
    req.on('end', () => { const [statut, texte] = reponse(corps, req.headers.authorization); res.writeHead(statut); res.end(texte); });
  });
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as net.AddressInfo).port}/gardien`, fermer: () => s.close() };
}

const decision = (d: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d, permissionDecisionReason: 'r' } });

test('décision du gardien transmise, entrée et jeton relayés', async () => {
  let recu = '';
  let auth: string | undefined;
  const g = await gardienFactice((c, a) => { recu = c; auth = a; return [200, decision('deny')]; });
  const r = await lancerHook(g.url);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.sortie).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(recu, ENTREE);
  assert.equal(auth, 'Bearer jeton-t41');
  g.fermer();
});

for (const [nom, statut, texte] of [['erreur 500', 500, 'boum'], ['réponse non JSON', 200, 'oui'], ['décision ask', 200, decision('ask')], ['décision inconnue', 200, decision('peut-etre')]] as const) {
  test(`fail-closed : ${nom} → exit 2`, async () => {
    const g = await gardienFactice(() => [statut, texte]);
    assert.equal((await lancerHook(g.url)).code, 2);
    g.fermer();
  });
}

test('fail-closed : gardien injoignable → exit 2', async () => {
  assert.equal((await lancerHook('http://127.0.0.1:1/gardien')).code, 2);
});
