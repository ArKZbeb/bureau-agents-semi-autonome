import { randomBytes } from 'node:crypto';

// Jetons en mémoire : un redémarrage les invalide, ce qui est voulu (aucun conteneur ne survit au redémarrage).
export class Jetons {
  #actifs = new Map<string, { tacheId: string; expire: number }>();
  #maintenant: () => number;

  constructor(maintenant: () => number = Date.now) {
    this.#maintenant = maintenant;
  }

  creer(tacheId: string, dureeMs: number): string {
    const jeton = randomBytes(32).toString('base64url');
    this.#actifs.set(jeton, { tacheId, expire: this.#maintenant() + dureeMs });
    return jeton;
  }

  valider(jeton: string | undefined): string | null {
    const e = jeton ? this.#actifs.get(jeton) : undefined;
    if (!jeton || !e) return null;
    if (e.expire <= this.#maintenant()) {
      this.#actifs.delete(jeton);
      return null;
    }
    return e.tacheId;
  }

  revoquer(tacheId: string): void {
    for (const [j, e] of this.#actifs) if (e.tacheId === tacheId) this.#actifs.delete(j);
  }
}
