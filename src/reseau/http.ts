import type { IncomingMessage, ServerResponse } from 'node:http';

export async function lireCorps(req: IncomingMessage, max: number): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  let taille = 0;
  for await (const m of req) {
    taille += (m as Buffer).length;
    if (taille > max) throw new Error('corps de requête trop volumineux');
    morceaux.push(m as Buffer);
  }
  return Buffer.concat(morceaux);
}

export function repondreJson(res: ServerResponse, statut: number, corps: unknown): void {
  res.writeHead(statut, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corps));
}
