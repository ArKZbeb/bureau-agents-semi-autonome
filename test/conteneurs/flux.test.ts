import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireLigne, decoupeurLignes } from '../../src/conteneurs/flux.ts';

const INIT = '{"type":"system","subtype":"init","cwd":"/workspace/projet","session_id":"43c06cbc","tools":["Bash","Read"]}';
const UI = '{"type":"system","subtype":"ui_invalidate","event":"ui.render","session_id":"43c06cbc"}';
const ASSISTANT = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"git status"}},{"type":"text","text":"je vérifie"}]},"parent_tool_use_id":null,"session_id":"43c06cbc"}';
const RESULTAT = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Exit code 1","is_error":true,"tool_use_id":"toolu_1"}]},"session_id":"43c06cbc"}';
const DIFFERE = '{"type":"result","subtype":"success","is_error":false,"stop_reason":"tool_deferred","terminal_reason":"tool_deferred","session_id":"43c06cbc","result":"","api_error_status":null,"deferred_tool_use":{"id":"toolu_4","name":"Bash","input":{"command":"npm install csv-parsr@0.1.2"}}}';
const ERREUR = '{"type":"result","subtype":"success","is_error":true,"stop_reason":null,"session_id":"s2","result":"API Error: 403 Budget de la tâche dépassé","api_error_status":403}';

test('événements extraits des lignes', () => {
  assert.deepEqual(lireLigne(INIT), [{ type: 'init', sessionId: '43c06cbc' }]);
  assert.deepEqual(lireLigne(UI), []);
  assert.deepEqual(lireLigne(ASSISTANT), [
    { type: 'outil', id: 'toolu_1', nom: 'Bash', entree: { command: 'git status' } }, { type: 'texte', texte: 'je vérifie' }]);
  assert.deepEqual(lireLigne(RESULTAT), [{ type: 'resultat_outil', id: 'toolu_1', contenu: 'Exit code 1', erreur: true }]);
  assert.deepEqual(lireLigne(DIFFERE), [{ type: 'fin', sessionId: '43c06cbc', sousType: 'success', stopReason: 'tool_deferred', erreur: false, apiErrorStatus: null, resultat: '', sortie: null, differe: { id: 'toolu_4', nom: 'Bash', entree: { command: 'npm install csv-parsr@0.1.2' } } }]);
  assert.equal((lireLigne(ERREUR)[0] as { apiErrorStatus: number }).apiErrorStatus, 403);
  assert.deepEqual(lireLigne('pas du json'), []);
  assert.deepEqual(lireLigne('{"type":"assistant","message":{"content":null}}'), []);
  assert.deepEqual(lireLigne('{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}'), []);
});

test('sortie structurée lue dans la ligne result', () => {
  const ligne = JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', is_error: false, result: '', structured_output: { resume: 'ok' } });
  const [fin] = lireLigne(ligne);
  assert.deepEqual((fin as { sortie: unknown }).sortie, { resume: 'ok' });
  const sans = JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', is_error: false, result: 'x' });
  assert.equal((lireLigne(sans)[0] as { sortie: unknown }).sortie, null);
});

test('découpage en lignes malgré des morceaux coupés au milieu d’un caractère', () => {
  const lignes: string[] = [];
  const decouper = decoupeurLignes(l => lignes.push(l));
  const tout = Buffer.from(`${INIT}\n${ASSISTANT}\n\n${RESULTAT}\n`);
  const coupure = tout.indexOf(Buffer.from('é')) + 1;
  decouper(tout.subarray(0, 10));
  decouper(tout.subarray(10, coupure));
  decouper(tout.subarray(coupure));
  assert.deepEqual(lignes, [INIT, ASSISTANT, RESULTAT]);
});
