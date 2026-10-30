import { randomBytes } from 'node:crypto';

// « agent » : API, gardien et sortie ; « sortie » (conteneurs d'analyse) : passerelle de sortie seulement.
export type Portee = 'agent' | 'sortie';

// Jetons en mémoire : un redémarrage les invalide, ce qui est voulu (aucun conteneur ne survit au redémarrage).
export class Jetons {
  #actifs = new Map<string, { tacheId: string; expire: number; portee: Portee }>();
  #maintenant: () => number;

  constructor(maintenant: () => number = Date.now) {
    this.#maintenant = maintenant;
  }

  creer(tacheId: string, dureeMs: number, portee: Portee = 'agent'): string {
    const jeton = randomBytes(32).toString('base64url');
    this.#actifs.set(jeton, { tacheId, expire: this.#maintenant() + dureeMs, portee });
    return jeton;
  }

  /** Tâche du jeton ; avec porteeExigee, un jeton d'une autre portée est refusé. */
  valider(jeton: string | undefined, porteeExigee?: Portee): string | null {
    const e = jeton ? this.#actifs.get(jeton) : undefined;
    if (!jeton || !e) return null;
    if (e.expire <= this.#maintenant()) {
      this.#actifs.delete(jeton);
      return null;
    }
    if (porteeExigee && e.portee !== porteeExigee) return null;
    return e.tacheId;
  }

  revoquer(tacheId: string): void {
    for (const [j, e] of this.#actifs) if (e.tacheId === tacheId) this.#actifs.delete(j);
  }
}
