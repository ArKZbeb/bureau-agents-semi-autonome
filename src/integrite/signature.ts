import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const sha256 = (contenu: string | Buffer): string => createHash('sha256').update(contenu).digest('hex');

export const hmac = (cle: Buffer, donnees: string): string => createHmac('sha256', cle).update(donnees).digest('hex');

export function hmacValide(cle: Buffer, donnees: string, attendu: string): boolean {
  const calcule = Buffer.from(hmac(cle, donnees), 'hex');
  const recu = Buffer.from(attendu, 'hex');
  return calcule.length === recu.length && timingSafeEqual(calcule, recu);
}
