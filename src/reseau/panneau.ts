import fs from 'node:fs';
import path from 'node:path';

export type FichierPanneau = { contenu: Buffer; type: string };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export const ENTETES_PANNEAU: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

// Chargé une fois au démarrage : le serveur ne lit jamais le disque d'après une URL.
export function chargerPanneau(dossier: string): Map<string, FichierPanneau> | null {
  if (!fs.lstatSync(path.join(dossier, 'index.html'), { throwIfNoEntry: false })?.isFile()) return null;
  const fichiers = new Map<string, FichierPanneau>();
  const parcourir = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dossier, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) parcourir(r);
      else if (e.isFile() && TYPES[path.extname(e.name).toLowerCase()])
        fichiers.set(`/${r}`, { contenu: fs.readFileSync(path.join(dossier, r)), type: TYPES[path.extname(e.name).toLowerCase()] });
    }
  };
  parcourir('');
  return fichiers;
}
