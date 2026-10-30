import type { Etape, Statut, Tache } from './modeles';

export const ETAPES: Etape[] = ['cadrage', 'patron_plan', 'implementation', 'review', 'patron_code', 'qa', 'validation'];
export const LIBELLE_ETAPE: Record<Etape, string> = {
  cadrage: 'Cadrage', patron_plan: 'Patron (plan)', implementation: 'Implémentation', review: 'Review',
  patron_code: 'Patron (code)', qa: 'QA', validation: 'Validation',
};
export const LIBELLE_STATUT: Record<Statut, string> = {
  prete: 'en file', en_cours: 'en cours', en_pause: 'en pause', bloquee: 'bloquée', attente_humain: 'en attente de toi',
  terminee: 'terminée', abandonnee: 'abandonnée',
};
const AGENTS: Record<string, string> = { cadreur: 'Cadreur', patron: 'Patron', implementeur: 'Implémenteur', reviewer: 'Reviewer', qa: 'QA' };
const AGENT_ETAPE: Record<Etape, string> = {
  cadrage: 'Cadreur', patron_plan: 'Patron', implementation: 'Implémenteur', review: 'Reviewer', patron_code: 'Patron', qa: 'QA', validation: 'Toi',
};

export const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;
export const budget = (t: Tache) => `${eur(t.depenseUsd)} / ${eur(t.budgetUsd)}`;
export const essai = (t: Tache) => (t.etape === 'cadrage' || t.etape === 'patron_plan' ? '' : `essai ${t.essaisQa + 1}/3`);
const raison = (t: Tache) => (t.raison ?? '').split(' : ')[0];

export function qui(t: Tache): string {
  const agent = (t.agent && AGENTS[t.agent]) ?? AGENT_ETAPE[t.etape];
  switch (t.statut) {
    case 'attente_humain': return t.etape === 'validation' ? 'Toi · à valider' : `${agent} · t’attend`;
    case 'en_pause': return raison(t) === 'budget' ? `${agent} · budget dépassé` : `${agent} · en pause`;
    case 'bloquee': return `Bloquée · ${t.raison ?? 'raison inconnue'}`;
    case 'prete': return 'En file';
    case 'terminee': return 'Terminée';
    case 'abandonnee': return 'Abandonnée';
    default: return agent;
  }
}

export const heure = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
