import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { construireImage } from '../src/conteneurs/image.ts';
import {
  arreterConteneurs, assurerPasserelle, creerConteneurAgent, demultiplexer, executerDans, lireFichierConteneur, lireFichierVolume, PLAFOND_ANALYSE,
  resoudreCheminConteneur, resoudreCheminVolume,
  fichierParametresVides, lireShaVolume, nomCopie, nomRessource, preparerCopieControle, supprimerCopieControle, preparerEspace, preparerReseau, RACINE_PROJET, supprimerReseau, verifierImage,
} from '../src/conteneurs/docker.ts';

const docker = new Docker();
const T = 'T-990';
let image: string;
let depot: string;

before(() => {
  image = construireImage(process.cwd());
  depot = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-depot-'));
  fs.writeFileSync(path.join(depot, 'README.md'), '# Film');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: depot });
});

after(async () => {
  await arreterConteneurs(docker, T);
  await supprimerReseau(docker, T);
  await docker.getVolume(nomRessource(T)).remove({ force: true }).catch(() => {});
});

test('image vérifiée par son ID', async () => {
  await verifierImage(docker, image);
  await assert.rejects(verifierImage(docker, `sha256:${'0'.repeat(64)}`), /absente ou différente/);
});

test('préparation : clone sans réseau, branche de la tâche', async () => {
  const volume = await preparerEspace(docker, image, T, depot);
  assert.equal(await lireFichierVolume(docker, image, volume, `${RACINE_PROJET}/README.md`), '# Film');
  assert.equal((await lireFichierVolume(docker, image, volume, `${RACINE_PROJET}/.git/HEAD`))?.trim(), 'ref: refs/heads/task/990');
  await assert.rejects(preparerEspace(docker, image, T, depot), /existe déjà/);
  assert.equal(await lireFichierVolume(docker, image, volume, `${RACINE_PROJET}/README.md`), '# Film', 'espace existant intact');
  assert.equal(await lireFichierVolume(docker, image, volume, '/etc/passwd'), null, 'lecture limitée au volume');
  assert.equal(await lireFichierVolume(docker, image, volume, '/workspace/../etc/passwd'), null, 'remontée refusée');
});

test('conteneur durci : non root, racine en lecture seule, sans capacité, sans socket ni sortie réseau', async () => {
  await assurerPasserelle(docker, image, 47999);
  const reseau = await preparerReseau(docker, T);
  assert.equal((await docker.getNetwork(reseau).inspect()).Internal, true);
  const c = await creerConteneurAgent(docker, { tacheId: T, imageId: image, reseau, volume: nomRessource(T), env: ['BUREAU_JETON=jeton'], ressources: { memoire: 512 * 1024 ** 2, cpus: 1, pids: 128 }, parametresVides: fichierParametresVides(fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-donnees-'))) });
  const info = await c.inspect();
  assert.equal(info.Config.User, 'node');
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(info.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(info.HostConfig.SecurityOpt, ['no-new-privileges']);
  assert.equal(info.HostConfig.Privileged, false);
  assert.equal(info.HostConfig.Memory, 512 * 1024 ** 2);
  assert.equal(info.HostConfig.PidsLimit, 128);
  assert.ok(!JSON.stringify(info.Mounts).includes('docker.sock'));

  const sh = async (script: string) => {
    let s = '';
    const r = await executerDans(c, ['sh', '-c', script], m => (s += m.toString('utf8')));
    return { code: r.code, sortie: s.trim() };
  };
  assert.equal((await sh('id -u')).sortie, '1000');
  assert.notEqual((await sh('touch /etc/pirate')).code, 0);
  assert.notEqual((await sh('echo {} > /etc/claude-code/managed-settings.json')).code, 0);
  assert.notEqual((await sh('echo x > /opt/hooks/hook-gardien.mjs')).code, 0);
  assert.equal((await sh('touch /workspace/projet/ok && echo oui')).sortie, 'oui');
  assert.equal((await sh('npm config get cache')).sortie, '/tmp/.npm', 'cache npm hors de la racine en lecture seule');
  assert.equal((await sh('npm cache verify > /dev/null 2>&1 && echo oui')).sortie, 'oui', 'cache npm inscriptible');
  assert.equal((await sh('test -e /var/run/docker.sock && echo present || echo absent')).sortie, 'absent');
  assert.match((await sh(`node -e "fetch('https://registry.npmjs.org',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('OUVERT'),()=>console.log('BLOQUE'))"`)).sortie, /BLOQUE/);
  assert.notEqual((await sh(`echo '{"env":{"X":"1"}}' > /workspace/.etat-claude/settings.json`)).code, 0);
  assert.equal((await sh('cat /workspace/.etat-claude/settings.json')).sortie, '{}');
  assert.equal(await lireFichierConteneur(c, `${RACINE_PROJET}/README.md`), '# Film');
  assert.equal(await lireFichierConteneur(c, '/workspace/../etc/passwd'), null);
  assert.equal((await sh('ln -s /etc/passwd /workspace/projet/lien && mkfifo /workspace/projet/f')).code, 0);
  assert.equal(await lireFichierConteneur(c, `${RACINE_PROJET}/lien`), null, 'lien symbolique refusé');
  assert.equal(await lireFichierConteneur(c, `${RACINE_PROJET}/f`), null, 'FIFO refusée');
  assert.equal(await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/lien`), null, 'lien symbolique refusé (volume)');
  assert.equal(await lireFichierVolume(docker, image, nomRessource(T), `${RACINE_PROJET}/f`), null, 'FIFO refusée (volume)');
  assert.equal((await sh('mkdir -p /workspace/projet/src && ln -s ../.git/hooks/pre-commit /workspace/projet/src/x')).code, 0);
  for (const resoudre of [(p: string) => resoudreCheminConteneur(c, p), (p: string) => resoudreCheminVolume(docker, image, nomRessource(T), p)]) {
    assert.equal(await resoudre(`${RACINE_PROJET}/src/x`), `${RACINE_PROJET}/.git/hooks/pre-commit`, 'lien vers les hooks Git résolu');
    assert.equal(await resoudre(`${RACINE_PROJET}/lien`), '/etc/passwd');
    assert.equal(await resoudre(`${RACINE_PROJET}/README.md`), `${RACINE_PROJET}/README.md`, 'fichier normal inchangé');
    assert.equal(await resoudre(`${RACINE_PROJET}/src/nouveau.ts`), `${RACINE_PROJET}/src/nouveau.ts`, 'fichier à créer : chemin normalisé');
  }
  assert.equal(await arreterConteneurs(docker, T), 1);
});

async function executerSurVolume(volume: string, script: string): Promise<void> {
  const c = await docker.createContainer({ Image: image, User: 'node', Cmd: ['sh', '-c', script], HostConfig: { NetworkMode: 'none', Mounts: [{ Type: 'volume', Source: volume, Target: '/workspace' }] } });
  await c.start();
  await c.wait();
  await c.remove({ force: true });
}

test('copie de contrôle : branche committée seulement, modifications jetées', async () => {
  const id = `T-CTRL-${Date.now()}`;
  try {
    await preparerEspace(docker, image, id, depot);
    await executerSurVolume(nomRessource(id), 'echo x > /workspace/cadrage/spec.md');
    assert.equal(await lireFichierVolume(docker, image, nomRessource(id), '/workspace/cadrage/spec.md'), 'x\n');
    // Fichier non commité dans l'espace de la tâche : absent de la copie.
    await executerSurVolume(nomRessource(id), `echo brouillon > ${RACINE_PROJET}/brouillon.txt`);
    const copie = await preparerCopieControle(docker, image, id);
    assert.equal(copie, nomCopie(id));
    assert.equal(await lireFichierVolume(docker, image, copie, `${RACINE_PROJET}/brouillon.txt`), null);
    assert.notEqual(await lireFichierVolume(docker, image, copie, `${RACINE_PROJET}/README.md`), null);
    // Écriture dans la copie : sans effet sur la branche.
    await executerSurVolume(copie, `echo modifie > ${RACINE_PROJET}/README.md`);
    assert.notEqual(await lireFichierVolume(docker, image, nomRessource(id), `${RACINE_PROJET}/README.md`), 'modifie\n');
    await supprimerCopieControle(docker, id);
    await assert.rejects(docker.getVolume(copie).inspect());
    await supprimerCopieControle(docker, id);
  } finally {
    await supprimerCopieControle(docker, id).catch(() => {});
    await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
  }
});

test('lecture plafonnée : fichier de 6 Mo refusé (null) au plafond ordinaire, lu entier au plafond d’analyse', async () => {
  const volume = `bureau-lecture-${Date.now()}`;
  await docker.createVolume({ Name: volume });
  try {
    await executerSurVolume(volume, 'head -c 6291456 /dev/zero | tr "\\0" a > /workspace/gros.patch');
    assert.equal(await lireFichierVolume(docker, image, volume, '/workspace/gros.patch'), null, 'jamais tronqué à 5 Mo');
    assert.equal((await lireFichierVolume(docker, image, volume, '/workspace/gros.patch', PLAFOND_ANALYSE))?.length, 6291456);
  } finally {
    await docker.getVolume(volume).remove({ force: true }).catch(() => {});
  }
});

test('copie de contrôle : tâche sans espace, rien n’est créé', async () => {
  const id = `T-SANS-${Date.now()}`;
  try {
    await assert.rejects(preparerCopieControle(docker, image, id), /espace de la tâche absent/);
    await assert.rejects(docker.getVolume(nomCopie(id)).inspect());
    await assert.rejects(docker.getVolume(nomRessource(id)).inspect());
  } finally {
    await supprimerCopieControle(docker, id).catch(() => {});
    await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
  }
});

/** Conteneur jetable durci, sans réseau : renvoie stdout et stderr du script. */
async function executerDansImage(imageId: string, script: string, tmpfs: Record<string, string> = {}, montages: Docker.MountConfig = []): Promise<string> {
  const c = await docker.createContainer({
    Image: imageId, User: 'node', Cmd: ['bash', '-c', script],
    HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], NetworkMode: 'none', Tmpfs: { '/tmp': 'rw', ...tmpfs }, Mounts: montages },
  });
  try {
    await c.start();
    await c.wait();
    const { stdout, stderr } = demultiplexer((await c.logs({ stdout: true, stderr: true, follow: false })) as unknown as Buffer);
    return stdout.toString('utf8') + stderr.toString('utf8');
  } finally {
    await c.remove({ force: true }).catch(() => {});
  }
}

const valeur = (sortie: string, cle: string) => sortie.match(new RegExp(`^${cle}=(.*)$`, 'm'))?.[1]?.trim();
const WORKSPACE_TMPFS = { '/workspace': 'rw,exec,uid=1000,gid=1000,size=256m' };
const MESURES_TMPFS = { '/mesures': 'rw,uid=1000,gid=1000,size=64m' };
const INIT_DEPOT = String.raw`
  set -e
  export HOME=/tmp
  rm -rf /workspace/projet && mkdir -p /workspace/projet && cd /workspace/projet
  git init -q && git config user.email t@t && git config user.name t
  echo base > README.md && git add . && git commit -qm base
  git rev-parse HEAD > /workspace/base
`;

test('image d’analyse : outils présents et scripts installés', async () => {
  // HOME inscriptible : Semgrep y écrit ses réglages, la racine est en lecture seule.
  const sortie = await executerDansImage(image, 'export HOME=/tmp && dotnet --list-sdks && semgrep --version && gitleaks version && chromium --version && test -x /opt/analyse/mesurer.sh && test -x /opt/analyse/tester.sh && test -f /opt/analyse/semgrep-regles.yml && test -f /opt/analyse/gitleaks.toml && echo OUTILS-OK');
  assert.match(sortie, /OUTILS-OK/);
});

test('mesures : base vérifiée, constats que le dépôt ne peut pas masquer, aucun secret recopié', async () => {
  const sortie = await executerDansImage(image, INIT_DEPOT + String.raw`
    echo ancien > supprime.txt && git add . && git commit -qm ancien && git rev-parse HEAD > /workspace/base
    BASE=$(cat /workspace/base)
    # Le dépôt tente de masquer ses constats : nosemgrep, .semgrepignore, gitleaks:allow, .gitleaks.toml,
    # .gitleaksignore, chemin de la liste blanche globale de gitleaks, fichier de plus de 1 Mo, .npmrc détourné.
    printf 'using System;\nusing System.Text.RegularExpressions;\npublic static class Motifs {\n  public static Regex Creer(string m) => new Regex(m, RegexOptions.None, TimeSpan.InfiniteMatchTimeout); // nosemgrep\n}\n' > ./-Motifs.cs
    { printf 'using System;\nusing System.Text.RegularExpressions;\npublic static class Gros {\n  public static Regex Creer(string m) => new Regex(m, RegexOptions.None, TimeSpan.InfiniteMatchTimeout);\n'; for i in $(seq 1 30000); do echo "  // remplissage pour dépasser un mégaoctet $i"; done; printf '}\n'; } > Gros.cs
    printf '*.cs\n' > .semgrepignore
    mkdir config deploy && printf 'aws_access_key_id = AKIAQ3EGRT7NMZ5WXPLA # gitleaks:allow\n' > config/aws.env
    printf 'aws_access_key_id = "AKIAZ7FAUX2CLE3TEST4"\n' > deploy/gitleaks.toml
    printf '[allowlist]\npaths = ["config/"]\n' > .gitleaks.toml
    mkdir front && echo '{"projects":{}}' > front/angular.json && printf 'registry=https://detourne.invalid/\n' > front/.npmrc
    echo '{"name":"f","version":"1.0.0","dependencies":{"lodash":"4.17.20"}}' > front/package.json
    echo '{"name":"f","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"f","version":"1.0.0","dependencies":{"lodash":"4.17.20"}},"node_modules/lodash":{"version":"4.17.20","resolved":"https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz"}}}' > front/package-lock.json
    git rm -q supprime.txt && git add . && git commit -qm fuite
    echo "$(git rev-parse HEAD):config/aws.env:aws-access-token:1" > .gitleaksignore && git add . && git commit -qm ignore
    set +e
    echo "TAILLE-GROS=$(( $(stat -c %s Gros.cs) > 1048576 ))"
    /opt/analyse/mesurer.sh "$BASE"; echo "CODE=$?"
    cd /mesures
    echo "SHA-OK=$([ "$(cat sha)" = "$(git -C /workspace/projet rev-parse HEAD)" ] && echo oui)"
    echo "MODIFIES=$(tr '\0' '\n' < fichiers-modifies | sort | tr '\n' ' ')"
    for o in semgrep gitleaks audit_npm; do echo "$o.code=$(cat $o.code)"; done
    node -e 'const r=JSON.parse(require("fs").readFileSync("semgrep.json","utf8")).results; console.log("SEMGREP=" + r.map(x => x.path + ":" + x.check_id.split(".").pop()).sort().join(","))'
    node -e 'const r=JSON.parse(require("fs").readFileSync("gitleaks.json","utf8")); console.log("GITLEAKS=" + r.map(x => x.File + ":" + x.RuleID + ":" + x.StartLine).sort().join(","))'
    node -e 'const j=JSON.parse(require("fs").readFileSync("npm-audit.json","utf8")); console.log("NPM-REGISTRE=" + (/registry\.npmjs\.org/.test(j.message) && !/detourne/.test(j.message)))'
    # diff.patch contient forcément les lignes ajoutées ; il n'est jamais recopié dans un artefact signé.
    echo "FUITE=$(grep -l -e AKIAQ3EGRT7NMZ5WXPLA -e AKIAZ7FAUX2CLE3TEST4 $(ls | grep -v '^diff.patch$') 2>/dev/null | tr '\n' ' ')"
    /opt/analyse/mesurer.sh 0123456789abcdef0123456789abcdef01234567; echo "BASE-ABSENTE=$? $(ls /mesures | wc -l)"
    /opt/analyse/mesurer.sh 'HEAD~1'; echo "BASE-INVALIDE=$? $(ls /mesures | wc -l)"
  `, { ...WORKSPACE_TMPFS, ...MESURES_TMPFS });
  assert.equal(valeur(sortie, 'TAILLE-GROS'), '1', 'fichier de plus de 1 Mo');
  assert.equal(valeur(sortie, 'CODE'), '0', sortie);
  assert.equal(valeur(sortie, 'SHA-OK'), 'oui', sortie);
  assert.equal(valeur(sortie, 'MODIFIES'), '-Motifs.cs .gitleaks.toml .gitleaksignore .semgrepignore Gros.cs config/aws.env deploy/gitleaks.toml front/.npmrc front/angular.json front/package-lock.json front/package.json', 'fichiers supprimés exclus');
  assert.equal(valeur(sortie, 'semgrep.code'), '0', sortie);
  assert.equal(valeur(sortie, 'gitleaks.code'), '0', sortie);
  assert.equal(valeur(sortie, 'SEMGREP'), '-Motifs.cs:regular-expression-dos-infinite-timeout,Gros.cs:regular-expression-dos-infinite-timeout', 'nosemgrep, .semgrepignore et taille sans effet');
  assert.equal(valeur(sortie, 'GITLEAKS'), 'config/aws.env:aws-access-token:1,deploy/gitleaks.toml:aws-access-token:1', 'gitleaks:allow, .gitleaks.toml, .gitleaksignore et liste blanche globale de chemins sans effet');
  assert.equal(valeur(sortie, 'audit_npm.code'), '1', 'npm audit en erreur (hors réseau) : mesure manquante');
  assert.equal(valeur(sortie, 'NPM-REGISTRE'), 'true', 'registre imposé malgré le .npmrc du dépôt');
  assert.equal(valeur(sortie, 'FUITE'), '', 'aucune valeur de secret dans les rapports');
  assert.equal(valeur(sortie, 'BASE-ABSENTE'), '3 0', 'base absente : arrêt, aucun résultat');
  assert.equal(valeur(sortie, 'BASE-INVALIDE'), '3 0', 'base non hexadécimale : arrêt, aucun résultat');
});

test('npm audit : le .npmrc du dépôt ne change pas l’audit du verrou', async () => {
  // Hors réseau, l'audit normal du verrou échoue sur la requête « advisories/bulk » ; un .npmrc qui détourne le
  // registre, désactive le verrou ou restreint l'audit à un espace de travail produirait une autre requête ou erreur.
  const sortie = await executerDansImage(image, INIT_DEPOT + String.raw`
    BASE=$(cat /workspace/base)
    mkdir front && echo '{"projects":{}}' > front/angular.json
    echo '{"name":"f","version":"1.0.0","dependencies":{"lodash":"4.17.20"}}' > front/package.json
    echo '{"name":"f","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"f","version":"1.0.0","dependencies":{"lodash":"4.17.20"}},"node_modules/lodash":{"version":"4.17.20","resolved":"https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz"}}}' > front/package-lock.json
    git add . && git commit -qm front
    set +e
    for npmrc in 'registry=https://detourne.invalid/' 'package-lock=false' 'workspace=x'; do
      printf '%s\n' "$npmrc" > front/.npmrc && git add . && git commit -qm npmrc
      /opt/analyse/mesurer.sh "$BASE" > /dev/null 2>&1
      echo "NPMRC $npmrc=$(cat /mesures/audit_npm.code) $(node -e 'const j=JSON.parse(require("fs").readFileSync("/mesures/npm-audit.json","utf8")); console.log(/^request to https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/advisories\/bulk failed/.test(j.message ?? ""))')"
    done
  `, { ...WORKSPACE_TMPFS, ...MESURES_TMPFS });
  for (const npmrc of ['registry=https://detourne.invalid/', 'package-lock=false', 'workspace=x'])
    assert.equal(valeur(sortie, `NPMRC ${npmrc}`), '1 true', `${npmrc} : audit du verrou sur le registre officiel\n${sortie}`);
});

test('cibles ambiguës ou refusées : mesure manquante', async () => {
  const sortie = await executerDansImage(image, INIT_DEPOT + String.raw`
    BASE=$(cat /workspace/base)
    touch a.sln b.sln && mkdir -p x y && echo '{}' > x/angular.json && echo '{}' > y/angular.json && touch x/package-lock.json
    git add . && git commit -qm ambigu
    set +e
    /opt/analyse/tester.sh > /dev/null 2>&1; echo "TESTER=$?"
    for o in tests_dotnet audit_dotnet tests_angular; do echo "AMBIGU-$o=$(cat /workspace/analyse/$o.code)"; done
    /opt/analyse/mesurer.sh "$BASE" > /dev/null 2>&1; echo "AMBIGU-audit_npm=$(cat /mesures/audit_npm.code)"
    cd /workspace/projet && git rm -q a.sln b.sln && touch 'Mon Projet.sln' && git add . && git commit -qm espace
    /opt/analyse/tester.sh > /dev/null 2>&1
    echo "REFUSE-tests_dotnet=$(cat /workspace/analyse/tests_dotnet.code)"
    cd /workspace/projet && git rm -q 'Mon Projet.sln' && mkdir -p src/Lib && touch Racine.sln src/Lib/Lib.csproj && git add . && git commit -qm profondeur
    /opt/analyse/tester.sh > /dev/null 2>&1
    echo "PROFONDEUR=$(grep -o 'Racine.sln' /workspace/analyse/dotnet-restore.log | head -n 1)"
  `, { ...WORKSPACE_TMPFS, ...MESURES_TMPFS });
  assert.equal(valeur(sortie, 'TESTER'), '0', sortie);
  for (const o of ['tests_dotnet', 'audit_dotnet', 'tests_angular', 'audit_npm']) assert.equal(valeur(sortie, `AMBIGU-${o}`), '3', `${o} : deux cibles à la même profondeur`);
  assert.equal(valeur(sortie, 'REFUSE-tests_dotnet'), '3', 'chemin de solution avec un espace refusé');
  assert.equal(valeur(sortie, 'PROFONDEUR'), 'Racine.sln', 'cible la moins profonde');
});

test('mesures hors de portée du code testé : un test hostile ne réécrit rien', async () => {
  const id = `T-MES-${Date.now()}`;
  const copie = nomRessource(id);
  const mesures = `${copie}-mesures`;
  const vol = (Source: string, Target: string, ReadOnly = false) => ({ Type: 'volume' as const, Source, Target, ReadOnly });
  try {
    await docker.createVolume({ Name: copie });
    await docker.createVolume({ Name: mesures });
    // Projet .NET restaurable hors ligne ; toute évaluation MSBuild (restauration comprise) lance en arrière-plan
    // une réécriture des résultats.
    await executerDansImage(image, INIT_DEPOT + String.raw`
      printf '%s\n' '<Project Sdk="Microsoft.NET.Sdk" InitialTargets="Pirate">' '  <PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup>' \
        '  <Target Name="Pirate">' \
        "    <Exec Command=\"nohup sh -c '(sleep 1; echo pirate > /workspace/analyse/semgrep.json; for f in /mesures/*; do echo pirate > \$f; done; echo pirate > /mesures/semgrep.json) 2>> /workspace/pirate.log; echo fini >> /workspace/pirate.log' > /dev/null 2>&amp;1 &amp;\" />" \
        '  </Target>' '</Project>' > Lib.csproj
      printf 'public static class Lib { public static int Un() => 1; }\n' > Lib.cs
      git add . && git commit -qm hostile
    `, {}, [vol(copie, '/workspace')]);
    const avant = await executerDansImage(image, String.raw`
      /opt/analyse/mesurer.sh "$(cat /workspace/base)"; echo "CODE=$?"
      echo "EMPREINTE=$(cd /mesures && sha256sum * | sha256sum | cut -c1-64)"
      echo "SEMGREP=$(node -e 'console.log(Array.isArray(JSON.parse(require("fs").readFileSync("/mesures/semgrep.json","utf8")).results))')"
    `, {}, [vol(copie, '/workspace', true), vol(mesures, '/mesures')]);
    assert.equal(valeur(avant, 'CODE'), '0', avant);
    assert.equal(valeur(avant, 'SEMGREP'), 'true', avant);
    const tests = await executerDansImage(image, String.raw`
      /opt/analyse/tester.sh; echo "CODE=$?"
      for i in $(seq 1 30); do grep -q fini /workspace/pirate.log 2>/dev/null && break; sleep 1; done
      echo "PIRATE=$(cat /workspace/analyse/semgrep.json)"
      echo "MESURES=$(ls -A /mesures | wc -l) $(touch /mesures/x 2> /dev/null && echo inscriptible || echo lecture-seule)"
    `, {}, [vol(copie, '/workspace')]);
    assert.equal(valeur(tests, 'CODE'), '0', tests);
    assert.equal(valeur(tests, 'PIRATE'), 'pirate', 'le code du dépôt a bien tourné dans le conteneur de tests');
    assert.equal(valeur(tests, 'MESURES'), '0 lecture-seule', 'volume des mesures absent du conteneur de tests');
    const apres = await executerDansImage(image, 'echo "EMPREINTE=$(cd /mesures && sha256sum * | sha256sum | cut -c1-64)"', {}, [vol(mesures, '/mesures', true)]);
    assert.equal(valeur(apres, 'EMPREINTE'), valeur(avant, 'EMPREINTE'), 'mesures intactes');
  } finally {
    await docker.getVolume(copie).remove({ force: true }).catch(() => {});
    await docker.getVolume(mesures).remove({ force: true }).catch(() => {});
  }
});

test('SHA lu dans le volume d’une tâche', async () => {
  const id = `T-${Date.now() % 100000}`;
  await preparerEspace(docker, image, id, depot);
  try {
    const sha = await lireShaVolume(docker, image, nomRessource(id));
    assert.match(sha ?? '', /^[0-9a-f]{40}$/);
    assert.equal(sha, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: depot }).toString().trim());
  } finally {
    await docker.getVolume(nomRessource(id)).remove({ force: true }).catch(() => {});
  }
});
