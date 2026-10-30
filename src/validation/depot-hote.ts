import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Executer = (commande: string, args: string[], o: { cwd: string }) => Promise<{ code: number; stdout: string; stderr: string }>;

// git et gh (et les hooks de mon dépôt, comme pre-push) ne reçoivent pas la clé API de l'orchestrateur.
function environnementHote(): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _cle, ...env } = process.env;
  return { ...env, GIT_TERMINAL_PROMPT: '0' };
}

export const executerHote: Executer = (commande, args, o) => new Promise((ok, ko) => {
  execFile(commande, args, { cwd: o.cwd, timeout: 120_000, maxBuffer: 10 * 1024 ** 2, env: environnementHote() }, (err, stdout, stderr) => {
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return ko(err);
    ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
  });
});

export async function importerBranche(executer: Executer, cheminDepot: string, bundle: Buffer, branche: string, sha: string): Promise<'importee' | 'deja_presente'> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('sha invalide : 40 caractères hexadécimaux attendus');
  if (!/^task\/[0-9a-z-]+$/.test(branche)) throw new Error(`nom de branche refusé : ${branche}`);
  const git = (...args: string[]) => executer('git', ['-C', cheminDepot, ...args], { cwd: cheminDepot });
  const ref = `refs/heads/${branche}`;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-bundle-'));
  try {
    const fichier = path.join(dossier, 'branche.bundle');
    fs.writeFileSync(fichier, bundle, { mode: 0o600 });
    if ((await git('rev-parse', '--git-dir')).code !== 0) throw new Error(`${cheminDepot} n’est pas un dépôt Git`);
    const existante = await git('rev-parse', '--verify', '--quiet', ref);
    if (existante.code === 0) {
      if (existante.stdout.trim() === sha) return 'deja_presente';
      throw new Error(`la branche ${branche} existe déjà dans ton dépôt sur un autre commit : rien n’a été modifié`);
    }
    const verif = await git('bundle', 'verify', fichier);
    if (verif.code !== 0) throw new Error(`bundle refusé par git : ${verif.stderr.slice(0, 300)}`);
    const rec = await git('-c', 'core.hooksPath=/dev/null', '-c', 'transfer.fsckObjects=true', 'fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', fichier, `${ref}:${ref}`);
    if (rec.code !== 0) throw new Error(`récupération refusée par git : ${rec.stderr.slice(0, 300)}`);
    const lue = (await git('rev-parse', '--verify', '--quiet', ref)).stdout.trim();
    if (lue !== sha) {
      if (lue) await git('-c', 'core.hooksPath=/dev/null', 'update-ref', '-d', ref, lue);
      throw new Error('commit importé différent du commit analysé : branche retirée');
    }
    return 'importee';
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

export async function ouvrirPr(executer: Executer, cheminDepot: string, branche: string, titre: string, corps: string): Promise<string> {
  const manuel = () => new Error(`aucun remote origin : pousse la branche puis ouvre la PR à la main : git push -u origin ${branche} && gh pr create --head ${branche}`);
  const git = (...args: string[]) => executer('git', ['-C', cheminDepot, ...args], { cwd: cheminDepot });
  if ((await git('remote', 'get-url', 'origin')).code !== 0) throw manuel();
  const push = await git('push', '-u', 'origin', branche);
  if (push.code !== 0) throw new Error(`push refusé : ${push.stderr.slice(0, 300)}`);
  let gh;
  try {
    gh = await executer('gh', ['pr', 'create', '--head', branche, '--title', titre, '--body', corps], { cwd: cheminDepot });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw manuel();
    throw e;
  }
  if (gh.code !== 0) throw new Error(`gh pr create a échoué : ${gh.stderr.slice(0, 300)}`);
  const url = gh.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('https://')).pop();
  if (!url) throw new Error('gh n’a pas rendu d’URL de pull request');
  return url;
}
