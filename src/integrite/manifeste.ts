import fs from 'node:fs';
import path from 'node:path';
import { AnomalieIntegrite } from './anomalie.ts';
import { hmac, hmacValide, sha256 } from './signature.ts';

export type Manifeste = { fichiers: Record<string, string>; image: string };

const DOSSIERS = ['agents', 'conteneur'];
const EXCLUS = /^conteneur\/certificats\//;
const NOM = 'manifeste.json';

export function calculerEmpreintes(racine: string): Record<string, string> {
  const fichiers = DOSSIERS.flatMap(d =>
    (fs.readdirSync(path.join(racine, d), { recursive: true }) as string[]).map(f => `${d}/${f.split(path.sep).join('/')}`),
  )
    .filter(f => !EXCLUS.test(f) && fs.statSync(path.join(racine, f)).isFile())
    .sort();
  return Object.fromEntries(fichiers.map(f => [f, sha256(fs.readFileSync(path.join(racine, f)))]));
}

export function ecrireManifeste(dossierDonnees: string, cle: Buffer, racine: string, image: string): Manifeste {
  const manifeste: Manifeste = { fichiers: calculerEmpreintes(racine), image };
  fs.mkdirSync(dossierDonnees, { recursive: true });
  fs.writeFileSync(path.join(dossierDonnees, NOM), JSON.stringify({ manifeste, signature: hmac(cle, JSON.stringify(manifeste)) }, null, 2));
  return manifeste;
}

export function verifierManifeste(dossierDonnees: string, cle: Buffer, racine: string): Manifeste {
  const chemin = path.join(dossierDonnees, NOM);
  if (!fs.existsSync(chemin)) throw new AnomalieIntegrite('manifeste', 'manifeste absent : lance npm run image');
  const { manifeste, signature } = JSON.parse(fs.readFileSync(chemin, 'utf8')) as { manifeste: Manifeste; signature: string };
  if (!hmacValide(cle, JSON.stringify(manifeste), signature)) throw new AnomalieIntegrite('manifeste', 'manifeste : signature invalide');
  const actuel = calculerEmpreintes(racine);
  for (const f of new Set([...Object.keys(manifeste.fichiers), ...Object.keys(actuel)]))
    if (manifeste.fichiers[f] !== actuel[f]) throw new AnomalieIntegrite(f, `${f} modifié depuis la génération du manifeste (npm run image)`);
  return manifeste;
}
