export const ETAPES = ['cadrage', 'patron_plan', 'implementation', 'review', 'patron_code', 'qa', 'validation'] as const;
export type Etape = (typeof ETAPES)[number];
export type Statut = 'prete' | 'en_cours' | 'en_pause' | 'bloquee' | 'attente_humain' | 'terminee' | 'abandonnee';
export type RaisonPause = 'escalade' | 'integrite' | 'budget' | 'erreur_api' | 'arret_global';
export type EtatTache = { etape: Etape; statut: Statut; raison: string | null; echangesPlan: number; essaisQa: number };

export type Evenement =
  | { type: 'demarrage' }
  | { type: 'etape_terminee'; verdict?: 'ok' | 'objection' | 'go' | 'no_go' }
  | { type: 'pause'; raison: RaisonPause; detail: string }
  | { type: 'bloquee'; detail: string }
  | { type: 'reprise' }
  | { type: 'redemarrage' }
  | { type: 'arbitrage'; choix: 'cadreur' | 'alternative' }
  | { type: 'validation'; decision: 'branche' | 'pr' | 'renvoi' | 'abandon' }
  | { type: 'abandon' };

export const MAX_ECHANGES_PLAN = 2;
export const MAX_ESSAIS_QA = 3;

export class TransitionInvalide extends Error {
  constructor(e: EtatTache, ev: Evenement) {
    super(`transition « ${ev.type} » impossible depuis ${e.etape} / ${e.statut}`);
    this.name = 'TransitionInvalide';
  }
}

const SUIVANTE: Partial<Record<Etape, Etape>> = { cadrage: 'patron_plan', implementation: 'review', review: 'patron_code', patron_code: 'qa' };

export function transition(e: EtatTache, ev: Evenement): EtatTache {
  const refuser = (): never => { throw new TransitionInvalide(e, ev); };
  if (e.statut === 'terminee' || e.statut === 'abandonnee') refuser();
  const prete = (etape: Etape, maj: Partial<EtatTache> = {}): EtatTache => ({ ...e, ...maj, etape, statut: 'prete', raison: null });

  switch (ev.type) {
    case 'demarrage':
      return e.statut === 'prete' ? { ...e, statut: 'en_cours', raison: null } : refuser();
    case 'redemarrage':
      return e.statut === 'en_cours' ? prete(e.etape) : refuser();
    case 'pause':
      return e.statut === 'en_cours' || e.statut === 'prete' ? { ...e, statut: 'en_pause', raison: `${ev.raison} : ${ev.detail}` } : refuser();
    case 'bloquee':
      return e.statut === 'en_cours' ? { ...e, statut: 'bloquee', raison: ev.detail } : refuser();
    case 'reprise':
      return e.statut === 'en_pause' || e.statut === 'bloquee' ? prete(e.etape) : refuser();
    case 'abandon':
      return { ...e, statut: 'abandonnee', raison: null };
    case 'arbitrage':
      if (e.etape !== 'patron_plan' || e.statut !== 'attente_humain') refuser();
      return ev.choix === 'cadreur' ? prete('implementation') : prete('cadrage');
    case 'validation':
      if (e.etape !== 'validation' || e.statut !== 'attente_humain') refuser();
      if (ev.decision === 'renvoi') return prete('implementation', { essaisQa: 0 });
      return { ...e, statut: ev.decision === 'abandon' ? 'abandonnee' : 'terminee', raison: null };
    case 'etape_terminee': {
      if (e.statut !== 'en_cours') refuser();
      const suivante = SUIVANTE[e.etape];
      if (suivante) return prete(suivante);
      if (e.etape === 'patron_plan') {
        if (ev.verdict === 'ok') return prete('implementation');
        if (ev.verdict !== 'objection') return refuser();
        const echangesPlan = e.echangesPlan + 1;
        return echangesPlan < MAX_ECHANGES_PLAN
          ? prete('cadrage', { echangesPlan })
          : { ...e, echangesPlan, statut: 'attente_humain', raison: `désaccord sur le plan après ${MAX_ECHANGES_PLAN} échanges : à trancher` };
      }
      if (e.etape === 'qa') {
        if (ev.verdict === 'go') return { ...e, etape: 'validation', statut: 'attente_humain', raison: 'en attente de ma validation' };
        if (ev.verdict !== 'no_go') return refuser();
        const essaisQa = e.essaisQa + 1;
        return essaisQa < MAX_ESSAIS_QA
          ? prete('implementation', { essaisQa })
          : { ...e, essaisQa, statut: 'bloquee', raison: `${MAX_ESSAIS_QA} no-go du QA : la tâche me revient` };
      }
      return refuser();
    }
  }
}
