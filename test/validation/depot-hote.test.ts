import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importerBranche, ouvrirPr, executerHote, type Executer } from '../../src/validation/depot-hote.ts';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-test-depot-'));
let n = 0;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' }).trim();
const dossier = () => path.join(racine, `d${n++}`);
const cloner = (origine: string) => { const d = dossier(); execFileSync('git', ['clone', '-q', origine, d]); return d; };

let origine: string;
let bundle: Buffer;
let sha: string;

before(() => {
  origine = dossier();
  fs.mkdirSync(origine);
  git(origine, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(origine, 'a.txt'), 'base\n');
  git(origine, 'add', '.');
  git(origine, 'commit', '-q', '-m', 'base');
  const travail = cloner(origine);
  git(travail, 'checkout', '-q', '-b', 'task/41');
  fs.writeFileSync(path.join(travail, 'b.txt'), 'tâche\n');
  git(travail, 'add', '.');
  git(travail, 'commit', '-q', '-m', 'tâche 41');
  sha = git(travail, 'rev-parse', 'task/41');
  const fichier = path.join(travail, 'b.bundle');
  git(travail, 'bundle', 'create', fichier, 'origin/main..task/41');
  bundle = fs.readFileSync(fichier);
});
after(() => fs.rmSync(racine, { recursive: true, force: true }));

const interdit: Executer = async () => { throw new Error('ne doit pas être appelé'); };

test('import : branche créée, branche courante et fichiers intacts', async () => {
  const depot = cloner(origine);
  const avant = git(depot, 'rev-parse', 'HEAD');
  assert.equal(await importerBranche(executerHote, depot, bundle, 'task/41', sha), 'importee');
  assert.equal(git(depot, 'rev-parse', 'task/41'), sha);
  assert.equal(git(depot, 'rev-parse', 'HEAD'), avant);
  assert.equal(git(depot, 'branch', '--show-current'), 'main');
  assert.equal(git(depot, 'status', '--porcelain'), '');
});

test('second import identique : deja_presente', async () => {
  const depot = cloner(origine);
  await importerBranche(executerHote, depot, bundle, 'task/41', sha);
  assert.equal(await importerBranche(executerHote, depot, bundle, 'task/41', sha), 'deja_presente');
});

test('branche existante sur un autre commit : refus, réf inchangée', async () => {
  const depot = cloner(origine);
  git(depot, 'branch', 'task/41');
  const avant = git(depot, 'rev-parse', 'task/41');
  await assert.rejects(importerBranche(executerHote, depot, bundle, 'task/41', sha), /existe déjà dans ton dépôt sur un autre commit : rien n’a été modifié/);
  assert.equal(git(depot, 'rev-parse', 'task/41'), avant);
});

test('sha attendu différent : branche retirée', async () => {
  const depot = cloner(origine);
  await assert.rejects(importerBranche(executerHote, depot, bundle, 'task/41', 'a'.repeat(40)), /commit importé différent/);
  assert.equal(git(depot, 'branch', '--list', 'task/41'), '');
});

test('dépôt sans le commit de base : bundle refusé par git', async () => {
  const depot = dossier();
  fs.mkdirSync(depot);
  git(depot, 'init', '-q');
  await assert.rejects(importerBranche(executerHote, depot, bundle, 'task/41', sha), /bundle refusé par git/);
});

test('dossier qui n’est pas un dépôt', async () => {
  const d = dossier();
  fs.mkdirSync(d);
  await assert.rejects(importerBranche(executerHote, d, bundle, 'task/41', sha), /n’est pas un dépôt Git/);
});

test('hook reference-transaction du dépôt : jamais exécuté', async () => {
  const depot = cloner(origine);
  const temoin = path.join(racine, 'temoin');
  const hook = path.join(depot, '.git', 'hooks', 'reference-transaction');
  fs.writeFileSync(hook, `#!/bin/sh\ntouch ${temoin}\n`, { mode: 0o755 });
  assert.equal(await importerBranche(executerHote, depot, bundle, 'task/41', sha), 'importee');
  assert.equal(fs.existsSync(temoin), false);
});

test('fetch : hooks désactivés et objets vérifiés, sans force', async () => {
  const appels: string[][] = [];
  const doublure: Executer = async (c, args, o) => { appels.push(args); return executerHote(c, args, o); };
  const depot = cloner(origine);
  await importerBranche(doublure, depot, bundle, 'task/41', sha);
  const fetch = appels.find((a) => a.includes('fetch'))!;
  assert.ok(fetch.includes('core.hooksPath=/dev/null') && fetch.includes('transfer.fsckObjects=true') && fetch.includes('--no-tags'));
  assert.ok(!fetch.some((a) => /force|^\+|^-f$/.test(a)));
});

test('branche ou sha invalides : refus avant tout appel', async () => {
  for (const b of ['main', 'task/41;rm', 'task/', 'task/A']) {
    await assert.rejects(importerBranche(interdit, '/x', bundle, b, sha), /branche/);
  }
  await assert.rejects(importerBranche(interdit, '/x', bundle, 'task/41', 'abc'), /sha/);
});

function enregistreur(reponses: (c: string, args: string[]) => { code: number; stdout?: string; stderr?: string } | Error) {
  const appels: { c: string; args: string[]; cwd: string }[] = [];
  const executer: Executer = async (c, args, o) => {
    appels.push({ c, args, cwd: o.cwd });
    const r = reponses(c, args);
    if (r instanceof Error) throw r;
    return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { appels, executer };
}

test('ouvrirPr : remote, push, gh dans l’ordre, arguments séparés, URL extraite', async () => {
  const { appels, executer } = enregistreur((c) => c === 'gh'
    ? { code: 0, stdout: 'Creating pull request\nhttps://github.com/o/r/pull/7\n\n' }
    : { code: 0, stdout: 'git@github.com:o/r.git\n' });
  const url = await ouvrirPr(executer, '/depot', 'task/41', 'Titre ; $(x)', 'Corps\nligne');
  assert.equal(url, 'https://github.com/o/r/pull/7');
  assert.deepEqual(appels.map((a) => [a.c, ...a.args]), [
    ['git', '-C', '/depot', 'remote', 'get-url', 'origin'],
    ['git', '-C', '/depot', 'push', '-u', 'origin', 'task/41'],
    ['gh', 'pr', 'create', '--head', 'task/41', '--title', 'Titre ; $(x)', '--body', 'Corps\nligne'],
  ]);
  assert.equal(appels[2].cwd, '/depot');
});

const MSG = /aucun remote origin : pousse la branche puis ouvre la PR à la main : git push -u origin task\/41 && gh pr create --head task\/41/;

test('ouvrirPr : remote absent', async () => {
  const { appels, executer } = enregistreur(() => ({ code: 2 }));
  await assert.rejects(ouvrirPr(executer, '/depot', 'task/41', 't', 'c'), MSG);
  assert.equal(appels.length, 1);
});

test('ouvrirPr : gh absent', async () => {
  const { executer } = enregistreur((c) => c === 'gh' ? Object.assign(new Error('spawn gh'), { code: 'ENOENT' }) : { code: 0, stdout: 'x\n' });
  await assert.rejects(ouvrirPr(executer, '/depot', 'task/41', 't', 'c'), MSG);
});
