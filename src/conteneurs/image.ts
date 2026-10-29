import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const NOM_IMAGE = 'bureau-agent:local';

/** Construit l'image et renvoie son ID (sha256:…), qui sert de référence dans le manifeste signé. */
export function construireImage(racine: string): string {
  return execFileSync('docker', ['build', '-q', '-t', NOM_IMAGE, path.join(racine, 'conteneur')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}
