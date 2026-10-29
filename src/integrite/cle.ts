import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AnomalieIntegrite } from './anomalie.ts';

// La clé ne quitte jamais l'hôte : elle n'est ni dans le dépôt ni dans un conteneur.
export function chargerOuCreerCle(dossier: string): Buffer {
  const chemin = path.join(dossier, 'cle-hmac');
  if (fs.existsSync(chemin)) {
    const cle = fs.readFileSync(chemin);
    if (cle.length !== 32) throw new AnomalieIntegrite('cle-hmac', 'clé HMAC de l’orchestrateur invalide');
    return cle;
  }
  fs.mkdirSync(dossier, { recursive: true });
  const cle = randomBytes(32);
  fs.writeFileSync(chemin, cle, { mode: 0o600, flag: 'wx' });
  return cle;
}
