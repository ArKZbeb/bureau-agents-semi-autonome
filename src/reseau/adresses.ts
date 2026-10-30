/** IPv4 privée (10/8, 172.16/12, 192.168/16), écrite sans zéro superflu. Jamais 0.0.0.0, jamais une adresse publique. */
function estIpv4Privee(a: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n, i) => n > 255 || String(n) !== m[i + 1])) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

/**
 * Adresses d'écoute du serveur des conteneurs : 127.0.0.1, plus la passerelle du pont Docker si c'est une IPv4 privée
 * (sous Linux, host.docker.internal pointe sur elle). La surcharge, validée de la même façon, remplace la passerelle.
 */
export function adressesConteneurs(passerelleBridge: string | null, surcharge?: string): string[] {
  const choix = surcharge !== undefined && surcharge !== '' ? surcharge : passerelleBridge;
  return choix !== null && estIpv4Privee(choix) ? ['127.0.0.1', choix] : ['127.0.0.1'];
}
