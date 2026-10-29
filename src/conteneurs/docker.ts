import Docker from 'dockerode';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';

export const RACINE_PROJET = '/workspace/projet';
export const DOSSIER_ETAT = '/workspace/.etat-claude';
/** Documents du cadreur (spec, plan), hors du dépôt git. */
export const DOSSIER_CADRAGE = '/workspace/cadrage';
export const PORT_INTERNE_PASSERELLE = 4311;
export const NOM_PASSERELLE = 'bureau-passerelle';
export const LABEL_TACHE = 'bureau.tache';
export const MESSAGE_SANS_DOCKER = "Docker n'est pas démarré. Le bureau a besoin de Docker pour isoler chaque tâche dans un conteneur éphémère. Sans lui, aucun agent ne peut démarrer ; les tâches existantes reprendront à leur dernière étape terminée dès que Docker répondra.";

export type Ressources = { memoire: number; cpus: number; pids: number };

// Appliqué à TOUS les conteneurs du bureau (agents, passerelle, conteneurs jetables).
const DURCISSEMENT = { ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Privileged: false, Init: true };

export const nomRessource = (tacheId: string) => `bureau-${tacheId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
export const brancheTache = (tacheId: string) => `task/${tacheId.replace(/^T-/i, '').toLowerCase()}`;
export const nomCopie = (tacheId: string) => `${nomRessource(tacheId)}-controle`;
const codeHttp = (e: unknown) => (e as { statusCode?: number }).statusCode;

export async function verifierDocker(docker: Docker): Promise<void> {
  try {
    await docker.ping();
  } catch {
    throw new Error(MESSAGE_SANS_DOCKER);
  }
}

export async function verifierImage(docker: Docker, imageId: string): Promise<void> {
  const id = await docker.getImage(imageId).inspect().then(i => i.Id, () => null);
  if (id !== imageId) throw new AnomalieIntegrite('image', `image Docker ${imageId.slice(7, 19)} absente ou différente : relance npm run image`);
}

export async function assurerPasserelle(docker: Docker, imageId: string, port: number): Promise<void> {
  const existante = docker.getContainer(NOM_PASSERELLE);
  try {
    const info = await existante.inspect();
    if (info.Image === imageId && info.State.Running && info.Config.Env.includes(`PORT_ORCHESTRATEUR=${port}`)) return;
    await existante.remove({ force: true });
  } catch (e) {
    if (codeHttp(e) !== 404) throw e;
  }
  const c = await docker.createContainer({
    name: NOM_PASSERELLE, Image: imageId, User: 'node', Cmd: ['node', '/opt/passerelle/passerelle.mjs'],
    Env: [`PORT_ORCHESTRATEUR=${port}`], Labels: { 'bureau.role': 'passerelle' },
    HostConfig: { ...DURCISSEMENT, Memory: 128 * 1024 ** 2, PidsLimit: 64, ExtraHosts: ['host.docker.internal:host-gateway'] },
  });
  await c.start();
}

/** Réseau interne propre à la tâche : aucune route, sauf la passerelle (alias « passerelle »). */
export async function preparerReseau(docker: Docker, tacheId: string): Promise<string> {
  const nom = nomRessource(tacheId);
  const existants = await docker.listNetworks({ filters: { name: [nom] } });
  let cree = false;
  if (existants.some(n => n.Name === nom)) {
    if ((await docker.getNetwork(nom).inspect()).Internal !== true) throw new Error(`réseau ${nom} non interne : refus de le réutiliser`);
  } else {
    await docker.createNetwork({ Name: nom, Internal: true, Labels: { [LABEL_TACHE]: tacheId } });
    cree = true;
  }
  try {
    await docker.getNetwork(nom).connect({ Container: NOM_PASSERELLE, EndpointConfig: { Aliases: ['passerelle'] } });
  } catch (e) {
    if (codeHttp(e) !== 403 && codeHttp(e) !== 409) {
      if (cree) await docker.getNetwork(nom).remove().catch(() => {});
      throw e;
    }
  }
  return nom;
}

export async function supprimerReseau(docker: Docker, tacheId: string): Promise<void> {
  const reseau = docker.getNetwork(nomRessource(tacheId));
  await reseau.disconnect({ Container: NOM_PASSERELLE, Force: true }).catch(() => {});
  await reseau.remove().catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; });
}

export function demultiplexer(brut: Buffer): { stdout: Buffer; stderr: Buffer } {
  const sorties: Buffer[][] = [[], []];
  for (let i = 0; i + 8 <= brut.length;) {
    const taille = brut.readUInt32BE(i + 4);
    sorties[brut[i] === 2 ? 1 : 0].push(brut.subarray(i + 8, i + 8 + taille));
    i += 8 + taille;
  }
  return { stdout: Buffer.concat(sorties[0]), stderr: Buffer.concat(sorties[1]) };
}

/** Conteneur jetable, sans réseau, pour les opérations de l'orchestrateur sur un volume. */
async function executerJetable(docker: Docker, imageId: string, cmd: string[], montages: Docker.MountConfig): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  const c = await docker.createContainer({
    Image: imageId, User: 'node', Cmd: cmd, Labels: { [LABEL_TACHE]: 'jetable' },
    HostConfig: { ...DURCISSEMENT, NetworkMode: 'none', Memory: 256 * 1024 ** 2, PidsLimit: 64, Tmpfs: { '/tmp': 'rw,nosuid,size=64m' }, Mounts: montages },
  });
  try {
    await c.start();
    let minuteur: NodeJS.Timeout | undefined;
    const delai = new Promise<never>((_, rejeter) => { minuteur = setTimeout(() => rejeter(new Error('conteneur jetable : délai dépassé')), 60_000); });
    const { StatusCode } = await Promise.race([c.wait(), delai]).finally(() => clearTimeout(minuteur));
    const brut = (await c.logs({ stdout: true, stderr: true, follow: false })) as unknown as Buffer;
    return { code: StatusCode, ...demultiplexer(brut) };
  } finally {
    await c.remove({ force: true }).catch(() => {});
  }
}

export async function preparerEspace(docker: Docker, imageId: string, tacheId: string, cheminProjet: string): Promise<string> {
  const volume = nomRessource(tacheId);
  const existe = await docker.getVolume(volume).inspect().then(() => true, (e: unknown) => { if (codeHttp(e) === 404) return false; throw e; });
  if (existe) throw new Error(`l’espace de ${tacheId} existe déjà`);
  await docker.createVolume({ Name: volume, Labels: { [LABEL_TACHE]: tacheId } });
  const branche = brancheTache(tacheId);
  const script = [
    // La source montée appartient à un autre uid : exception déclarée dans un HOME jetable (-c n'est pas honoré par git clone).
    'export HOME=/tmp',
    `git config --global --add safe.directory '*'`,
    `git clone --quiet --no-hardlinks /source ${RACINE_PROJET}`,
    `cd ${RACINE_PROJET}`,
    `git checkout --quiet -b ${branche}`,
    `git config user.name "Bureau d'agents"`,
    'git config user.email bureau@localhost',
    `mkdir -p ${DOSSIER_ETAT} ${DOSSIER_CADRAGE}`,
  ].join(' && ');
  const r = await executerJetable(docker, imageId, ['sh', '-c', script], [
    { Type: 'volume', Source: volume, Target: '/workspace' },
    { Type: 'bind', Source: cheminProjet, Target: '/source', ReadOnly: true },
  ]);
  if (r.code !== 0) {
    await docker.getVolume(volume).remove({ force: true }).catch(() => {});
    throw new Error(`préparation de l’espace de ${tacheId} impossible : ${r.stderr.toString('utf8').slice(-500)}`);
  }
  return volume;
}

const cheminConfine = (chemin: string) => path.posix.normalize(chemin).startsWith('/workspace/');
// Résout les liens, refuse tout ce qui n'est pas un fichier régulier sous /workspace, plafonne à 5 Mo.
const commandeLecture = (chemin: string) => ['sh', '-c', 'p=$(readlink -f -- "$1") || exit 3; case "$p" in /workspace/*) ;; *) exit 3;; esac; [ -f "$p" ] || exit 3; exec head -c 5242880 -- "$p"', 'lecture', chemin];

export async function lireFichierVolume(docker: Docker, imageId: string, volume: string, chemin: string): Promise<string | null> {
  if (!cheminConfine(chemin)) return null;
  const r = await executerJetable(docker, imageId, commandeLecture(chemin), [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }]);
  return r.code === 0 ? r.stdout.toString('utf8') : null;
}

// readlink -m : résout tous les liens, même si la cible finale n'existe pas encore (fichier à créer).
const commandeResolution = (chemin: string) => ['readlink', '-m', '--', chemin];
const cheminResolu = (code: number, sortie: Buffer): string | null => {
  const s = sortie.toString('utf8');
  return code === 0 && s.startsWith('/') && s.endsWith('\n') ? s.slice(0, -1) : null;
};

export async function resoudreCheminVolume(docker: Docker, imageId: string, volume: string, chemin: string): Promise<string | null> {
  const r = await executerJetable(docker, imageId, commandeResolution(chemin), [{ Type: 'volume', Source: volume, Target: '/workspace', ReadOnly: true }]);
  return cheminResolu(r.code, r.stdout);
}

export async function creerConteneurAgent(
  docker: Docker,
  o: { tacheId: string; imageId: string; reseau: string; volume: string; env: string[]; ressources: Ressources; parametresVides: string },
): Promise<Docker.Container> {
  const c = await docker.createContainer({
    Image: o.imageId, User: 'node', WorkingDir: RACINE_PROJET, Cmd: ['sleep', 'infinity'], Env: o.env,
    Labels: { [LABEL_TACHE]: o.tacheId },
    HostConfig: {
      ...DURCISSEMENT, NetworkMode: o.reseau, Memory: o.ressources.memoire, NanoCpus: Math.round(o.ressources.cpus * 1e9),
      PidsLimit: o.ressources.pids, Tmpfs: { '/tmp': 'rw,nosuid,size=512m' },
      Mounts: [
        { Type: 'volume', Source: o.volume, Target: '/workspace' },
        // Écrase les paramètres utilisateur de Claude Code (inscriptibles par l'agent) : un « env » injecté pourrait contourner le hook.
        { Type: 'bind', Source: o.parametresVides, Target: `${DOSSIER_ETAT}/settings.json`, ReadOnly: true },
      ],
    },
  });
  try {
    await c.start();
  } catch (e) {
    await c.remove({ force: true }).catch(() => {});
    throw e;
  }
  return c;
}

export async function executerDans(conteneur: Docker.Container, cmd: string[], surSortie: (m: Buffer) => void): Promise<{ code: number; erreurs: string }> {
  const exec = await conteneur.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, User: 'node', WorkingDir: RACINE_PROJET });
  const flux = await exec.start({ hijack: true, stdin: false });
  const sortie = new PassThrough();
  const erreur = new PassThrough();
  let erreurs = '';
  sortie.on('data', surSortie);
  erreur.on('data', (m: Buffer) => { erreurs = (erreurs + m.toString('utf8')).slice(-4000); });
  conteneur.modem.demuxStream(flux, sortie, erreur);
  await new Promise<void>(fin => { flux.on('end', fin); flux.on('close', fin); flux.on('error', () => fin()); });
  const info = await exec.inspect().catch(() => null);
  return { code: info?.ExitCode ?? -1, erreurs };
}

export async function lireFichierConteneur(conteneur: Docker.Container, chemin: string): Promise<string | null> {
  if (!cheminConfine(chemin)) return null;
  const morceaux: Buffer[] = [];
  const r = await Promise.race([
    executerDans(conteneur, commandeLecture(chemin), m => morceaux.push(m)),
    new Promise<null>(fin => setTimeout(() => fin(null), 30_000).unref()),
  ]);
  return r && r.code === 0 ? Buffer.concat(morceaux).toString('utf8') : null;
}

export async function resoudreCheminConteneur(conteneur: Docker.Container, chemin: string): Promise<string | null> {
  const morceaux: Buffer[] = [];
  const r = await Promise.race([
    executerDans(conteneur, commandeResolution(chemin), m => morceaux.push(m)),
    new Promise<null>(fin => setTimeout(() => fin(null), 30_000).unref()),
  ]);
  return r ? cheminResolu(r.code, Buffer.concat(morceaux)) : null;
}

export async function arreterConteneurs(docker: Docker, tacheId?: string): Promise<number> {
  const liste = await docker.listContainers({ all: true, filters: { label: [tacheId ? `${LABEL_TACHE}=${tacheId}` : LABEL_TACHE] } });
  await Promise.all(liste.map(i => docker.getContainer(i.Id).remove({ force: true }).catch(() => {})));
  return liste.length;
}

/** Fichier de paramètres utilisateur vide, monté en lecture seule sur celui de l'agent. */
export function fichierParametresVides(dossierDonnees: string): string {
  const fichier = path.resolve(dossierDonnees, 'parametres-utilisateur-agent.json');
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  if (!fs.existsSync(fichier)) fs.writeFileSync(fichier, '{}');
  return fichier;
}

/** Volume jetable cloné depuis la branche : les agents en lecture seule y compilent et testent sans toucher à la branche. */
export async function preparerCopieControle(docker: Docker, imageId: string, tacheId: string): Promise<string> {
  const volume = nomCopie(tacheId);
  // Un montage de type volume créerait un volume source vide s'il manquait : on vérifie avant.
  await docker.getVolume(nomRessource(tacheId)).inspect().catch((e: unknown) => {
    if (codeHttp(e) === 404) throw new Error(`copie de contrôle de ${tacheId} impossible : espace de la tâche absent`);
    throw e;
  });
  await supprimerCopieControle(docker, tacheId);
  await docker.createVolume({ Name: volume, Labels: { [LABEL_TACHE]: tacheId } });
  const script = [
    'export HOME=/tmp',
    `git config --global --add safe.directory '*'`,
    `git clone --quiet --no-hardlinks --branch '${brancheTache(tacheId)}' /source/projet ${RACINE_PROJET}`,
    `cd ${RACINE_PROJET}`,
    `git config user.name "Bureau d'agents"`,
    'git config user.email bureau@localhost',
    `mkdir -p ${DOSSIER_ETAT}`,
  ].join(' && ');
  const r = await executerJetable(docker, imageId, ['sh', '-c', script], [
    { Type: 'volume', Source: volume, Target: '/workspace' },
    { Type: 'volume', Source: nomRessource(tacheId), Target: '/source', ReadOnly: true },
  ]);
  if (r.code !== 0) {
    await supprimerCopieControle(docker, tacheId);
    throw new Error(`copie de contrôle de ${tacheId} impossible : ${r.stderr.toString('utf8').slice(-500)}`);
  }
  return volume;
}

export async function supprimerCopieControle(docker: Docker, tacheId: string): Promise<void> {
  await docker.getVolume(nomCopie(tacheId)).remove({ force: true }).catch((e: unknown) => { if (codeHttp(e) !== 404) throw e; });
}
