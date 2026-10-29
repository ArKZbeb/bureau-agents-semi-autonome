import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type net from 'node:net';
import { spawn } from 'node:child_process';

const ENTREE = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, tool_use_id: 'toolu_1' });

function lancerHook(args: string[], entree = ENTREE, env: Record<string, string> = {}): Promise<{ code: number | null; sortie: string }> {
  return new Promise(ok => {
    const base: NodeJS.ProcessEnv = { ...process.env };
    delete base.BUREAU_URL_GARDIEN;
    const p = spawn(process.execPath, ['conteneur/hook-gardien.mjs', ...args], { env: { ...base, BUREAU_JETON: 'jeton-t41', ...env } });
    let sortie = '';
    p.stdout.on('data', d => (sortie += d));
    p.on('close', code => ok({ code, sortie }));
    p.stdin.end(entree);
  });
}

async function gardienFactice(t: TestContext, reponse: (corps: string, auth: string | undefined) => [number, string]) {
  const s = http.createServer((req, res) => {
    let corps = '';
    req.on('data', d => (corps += d));
    req.on('end', () => { const [statut, texte] = reponse(corps, req.headers.authorization); res.writeHead(statut); res.end(texte); });
  });
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  t.after(() => s.close());
  return `http://127.0.0.1:${(s.address() as net.AddressInfo).port}/gardien`;
}

const decision = (d: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d, permissionDecisionReason: 'r' } });

test('décision du gardien transmise, entrée et jeton relayés', async t => {
  let recu = '';
  let auth: string | undefined;
  const url = await gardienFactice(t, (c, a) => { recu = c; auth = a; return [200, decision('deny')]; });
  const r = await lancerHook([url]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.sortie).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(recu, ENTREE);
  assert.equal(auth, 'Bearer jeton-t41');
});

test('allow et defer passent avec exit 0', async t => {
  for (const d of ['allow', 'defer']) {
    const url = await gardienFactice(t, () => [200, decision(d)]);
    const r = await lancerHook([url]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.sortie).hookSpecificOutput.permissionDecision, d);
  }
});

test('BUREAU_URL_GARDIEN dans l’environnement est ignorée', async t => {
  const autorise = await gardienFactice(t, () => [200, decision('allow')]);
  const refuse = await gardienFactice(t, () => [200, decision('deny')]);
  const r = await lancerHook([refuse], ENTREE, { BUREAU_URL_GARDIEN: autorise });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.sortie).hookSpecificOutput.permissionDecision, 'deny');
});

test('entrée multioctet à cheval sur 64 KiB transmise intacte', async t => {
  const entree = 'a'.repeat(65535) + 'é' + 'fin';
  let recu = '';
  const url = await gardienFactice(t, c => { recu = c; return [200, decision('allow')]; });
  const r = await lancerHook([url], entree);
  assert.equal(r.code, 0);
  assert.equal(recu, entree);
});

for (const [nom, statut, texte] of [['erreur 500', 500, 'boum'], ['réponse non JSON', 200, 'oui'], ['décision ask', 200, decision('ask')], ['décision inconnue', 200, decision('peut-etre')]] as const) {
  test(`fail-closed : ${nom} → exit 2`, async t => {
    const url = await gardienFactice(t, () => [statut, texte]);
    assert.equal((await lancerHook([url])).code, 2);
  });
}

test('fail-closed : gardien injoignable → exit 2', async () => {
  assert.equal((await lancerHook(['http://127.0.0.1:1/gardien'])).code, 2);
});
