import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { chargerConfig } from '../src/config.ts';
import { chargerOuCreerCle } from '../src/integrite/cle.ts';
import { ecrireManifeste } from '../src/integrite/manifeste.ts';
import { lireJournal } from '../src/integrite/journal.ts';
import { AnomalieIntegrite } from '../src/integrite/anomalie.ts';
import { construireImage } from '../src/conteneurs/image.ts';
import { LABEL_TACHE, nomRessource, preparerCopieControle, RACINE_PROJET, supprimerCopieControle } from '../src/conteneurs/docker.ts';
import { executerAnalyse } from '../src/analyse/execution.ts';
import { demarrerOrchestrateur, type Orchestrateur } from '../src/orchestrateur.ts';
import { lireTache } from '../src/taches/depot.ts';
import type { ClientAvis } from '../src/gardien/avis.ts';

const docker = new Docker();
const RACINE_DEPOT = process.cwd();
const T = 'T-960';
// Fausse clé AWS à entropie suffisante pour la règle aws-access-token de gitleaks (spike E16) : jamais une vraie clé.
const FAUX_SECRET = 'AKIAZ7FAUX2CLE3TEST4';

let image: string;
let o: Orchestrateur;

function depotDotnet(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-dotnet-'));
  fs.cpSync(path.join(RACINE_DEPOT, 'test/fixtures/projet-dotnet'), d, { recursive: true });
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base']]) execFileSync('git', args, { cwd: d });
  return d;
}

/** Conteneur jetable sans réseau sur un volume (mise en place du test). */
async function executerSurVolume(volume: string, script: string): Promise<number> {
  const c = await docker.createContainer({ Image: image, User: 'node', Cmd: ['sh', '-c', script], HostConfig: { NetworkMode: 'none', Mounts: [{ Type: 'volume', Source: volume, Target: '/workspace' }] } });
  try {
    await c.start();
    return (await c.wait()).StatusCode;
  } finally {
    await c.remove({ force: true });
  }
}

describe('Analyse de review dans des conteneurs durcis', () => {
  before(async () => {
    image = construireImage(RACINE_DEPOT);
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-donnees-'));
    const cle = chargerOuCreerCle(dossier);
    ecrireManifeste(dossier, cle, RACINE_DEPOT, image);
    const clientAvis = { messages: { parse: async () => { throw new Error('aucun appel API attendu'); } } } as unknown as ClientAvis;
    const config = { ...chargerConfig({ BUREAU_DONNEES: dossier }), portUi: 47330, portConteneurs: 47331, cleApi: 'cle-factice-de-test' };
    o = await demarrerOrchestrateur({ config, racineDepot: RACINE_DEPOT, docker, clientAvis });
    await o.ordonnanceur.arreter();
    // Tâche créée au commit de base ; la branche reçoit ensuite une méthode non testée et un faux secret.
    await o.creerTache({ id: T, projet: 'Film', titre: 'Affichage du titre', cheminProjet: depotDotnet(), budgetUsd: 5, demande: 'Afficher le titre' });
    const code = await executerSurVolume(nomRessource(T), String.raw`
      set -e
      export HOME=/tmp
      cd ${RACINE_PROJET}
      cat > Film/Film.cs <<'EOF'
namespace Film;

public static class Fiche
{
    public static string Titre(string nom, int annee) => $"{nom} ({annee})";

    public static string Affiche(string nom)
    {
        var propre = nom.Trim();
        return propre.ToUpperInvariant();
    }
}
EOF
      printf '{\n  "aws_secret_access_key": "${FAUX_SECRET}"\n}\n' > appsettings.secret.json
      git add . && git commit -qm "feat: affiche"
    `);
    assert.equal(code, 0, 'commit de la branche');
  });

  after(async () => {
    await o?.arreter();
    await supprimerCopieControle(docker, T).catch(() => {});
    await docker.getVolume(nomRessource(T)).remove({ force: true }).catch(() => {});
    await docker.getVolume(`${nomRessource(T)}-mesures`).remove({ force: true }).catch(() => {});
  });

  test('analyse réelle du projet .NET : tests verts, couverture des lignes modifiées, secret détecté', async () => {
    const tache = lireTache(o.db, T);
    assert.match(tache.commitBase ?? '', /^[0-9a-f]{40}$/);
    const volume = await preparerCopieControle(docker, image, T);
    try {
      const a = await executerAnalyse(o.execution, T, volume, tache.commitBase!);
      const detail = JSON.stringify(a, null, 2);
      assert.match(a.sha, /^[0-9a-f]{40}$/, detail);
      assert.notEqual(a.sha, tache.commitBase);
      assert.equal(a.base, tache.commitBase);
      assert.equal(a.outils.tests_dotnet, 'ok', detail);
      assert.equal(a.outils.audit_dotnet, 'ok', `audit .NET par la passerelle\n${detail}`);
      assert.equal(a.outils.tests_angular, 'non_applicable', detail);
      assert.equal(a.outils.audit_npm, 'non_applicable', detail);
      assert.equal(a.outils.semgrep, 'ok', detail);
      assert.equal(a.outils.gitleaks, 'ok', detail);
      assert.equal(a.outils.couverture, 'ok', detail);
      assert.ok(a.tests && a.tests.total >= 1 && a.tests.echecs === 0, detail);
      assert.ok(a.couverture && a.couverture.pourcentage !== null && a.couverture.pourcentage < 100, `méthode non testée\n${detail}`);
      assert.ok(a.constats.some(c => c.outil === 'gitleaks' && c.fichier?.startsWith('appsettings.secret.json')), detail);
      assert.ok(!detail.includes(FAUX_SECRET) && !detail.includes('AKIA'), 'aucune valeur de secret');

      const journal = lireJournal(o.db, T).filter(e => e.raison.startsWith('analyse de review'));
      assert.equal(journal.length, 7);
      assert.ok(journal.every(e => e.type === 'evenement' && e.decideur === 'Orchestrateur' && e.couche === '—' && e.decision === 'Autorisé'));
      assert.ok(journal.some(e => e.commande === 'gitleaks' && e.raison === 'analyse de review : ok'));
      assert.ok(journal.some(e => e.commande === 'ng test' && e.raison === 'analyse de review : non_applicable'));

      // Ressources de l'analyse retirées : volume des mesures, conteneurs, réseau.
      await assert.rejects(docker.getVolume(`${nomRessource(T)}-mesures`).inspect());
      assert.equal((await docker.listContainers({ all: true, filters: { label: [`${LABEL_TACHE}=${T}`] } })).length, 0);
      assert.equal((await docker.listNetworks({ filters: { name: [nomRessource(T)] } })).filter(n => n.Name === nomRessource(T)).length, 0);
    } finally {
      await supprimerCopieControle(docker, T);
    }
  });

  test('commit de base invalide : anomalie d’intégrité, aucun conteneur', async () => {
    await assert.rejects(executerAnalyse(o.execution, T, `${nomRessource(T)}-controle`, 'HEAD~1'), (e: unknown) => e instanceof AnomalieIntegrite && /commit de base invalide/.test(e.message));
    assert.equal((await docker.listContainers({ all: true, filters: { label: [`${LABEL_TACHE}=${T}`] } })).length, 0);
  });
});
