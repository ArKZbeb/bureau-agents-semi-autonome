export const ETAPES = ['cadrage', 'patron_plan', 'implementation', 'review', 'patron_code', 'qa', 'validation'] as const;
export type Etape = (typeof ETAPES)[number];
export type Statut = 'prete' | 'en_cours' | 'en_pause' | 'bloquee' | 'attente_humain' | 'terminee' | 'abandonnee';
export type RaisonPause = 'escalade' | 'integrite' | 'budget' | 'erreur_api' | 'arret_global';
export type EtatTache = { etape: Etape; statut: Statut; raison: string | null; echangesPlan: number; essaisQa: number };

export const RAISON_QUESTIONS = 'le cadreur attend ta réponse';
export const RAISON_PROPOSITION = 'spec et plan à valider';

export type Evenement =
  | { type: 'demarrage' }
  | { type: 'etape_terminee'; verdict?: 'ok' | 'objection' | 'go' | 'no_go' | 'questions' | 'proposition' }
  | { type: 'pause'; raison: RaisonPause; detail: string }
  | { type: 'bloquee'; detail: string }
  | { type: 'reprise' }
  | { type: 'redemarrage' }
  | { type: 'arbitrage'; choix: 'cadreur' | 'alternative' }
  | { type: 'reponse_cadrage' }
  | { type: 'validation_cadrage' }
  | { type: 'validation'; decision: 'branche' | 'pr' | 'renvoi' | 'abandon' }
  | { type: 'relance'; vers: 'implementation' | 'cadrage' }
  | { type: 'abandon' };

export const MAX_ECHANGES_PLAN = 2;
export const MAX_ESSAIS_QA = 3;

export class TransitionInvalide extends Error {
  constructor(e: EtatTache, ev: Evenement) {
    super(`transition « ${ev.type} » impossible depuis ${e.etape} / ${e.statut}`);
    this.name = 'TransitionInvalide';
  }
}

const SUIVANTE: Partial<Record<Etape, Etape>> = { implementation: 'review', review: 'patron_code', patron_code: 'qa' };

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
      return e.statut === 'attente_humain' || e.statut === 'en_pause' || e.statut === 'bloquee' ? { ...e, statut: 'abandonnee', raison: null } : refuser();
    case 'relance': {
      if (e.statut === 'bloquee') return ev.vers === 'implementation' ? prete('implementation', { essaisQa: 0 }) : prete('cadrage', { essaisQa: 0, echangesPlan: 0 });
      // Alerte d'intégrité : « compter comme no-go et relancer ».
      if (e.statut !== 'en_pause' || !e.raison?.startsWith('integrite') || ev.vers !== 'implementation') return refuser();
      const essaisQa = e.essaisQa + 1;
      return essaisQa < MAX_ESSAIS_QA
        ? prete('implementation', { essaisQa })
        : { ...e, essaisQa, statut: 'bloquee', raison: `${MAX_ESSAIS_QA} no-go du QA : la tâche me revient` };
    }
    case 'arbitrage':
      if (e.etape !== 'patron_plan' || e.statut !== 'attente_humain') refuser();
      return ev.choix === 'cadreur' ? prete('implementation') : prete('cadrage');
    case 'reponse_cadrage':
      if (e.etape !== 'cadrage' || e.statut !== 'attente_humain') refuser();
      return prete('cadrage');
    case 'validation_cadrage':
      if (e.etape !== 'cadrage' || e.statut !== 'attente_humain' || e.raison !== RAISON_PROPOSITION) refuser();
      return prete('patron_plan');
    case 'validation':
      if (e.etape !== 'validation' || e.statut !== 'attente_humain') refuser();
      if (ev.decision === 'renvoi') return prete('implementation', { essaisQa: 0 });
      return { ...e, statut: ev.decision === 'abandon' ? 'abandonnee' : 'terminee', raison: null };
    case 'etape_terminee': {
      if (e.statut !== 'en_cours') refuser();
      if (e.etape === 'cadrage') {
        if (ev.verdict === 'questions') return { ...e, statut: 'attente_humain', raison: RAISON_QUESTIONS };
        if (ev.verdict === 'proposition') return { ...e, statut: 'attente_humain', raison: RAISON_PROPOSITION };
        return refuser();
      }
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
