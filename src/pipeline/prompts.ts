import type { EtapeAgent } from '../agents/definitions.ts';
import type { Base } from '../db.ts';
import { lireArtefact, type TypeArtefact } from '../integrite/artefacts.ts';
import type { Tache } from '../taches/depot.ts';
import { listerEchanges, lireProposition } from '../taches/echanges.ts';

export const numeroterCriteres = (criteres: string[]) => criteres.map((c, i) => `${i + 1}. ${c}\n`).join('');
export const lireCriteres = (texte: string) => [...texte.matchAll(/^\d+\.[ \t]+(.+)$/gm)].map(m => m[1]);

export function extraireCriteres(spec: string): string[] {
  const section = spec.split(/^## /m).find(s => /^Crit[èe]res d['’]acceptation/i.test(s));
  return section ? lireCriteres(section) : [];
}

const CONSIGNES: Record<EtapeAgent, string> = {
  cadrage: 'Consigne : propose la spec, les critères et le plan de cette demande, ou pose tes questions.',
  patron_plan: 'Consigne : examine le plan validé et donne ton verdict.',
  implementation: 'Consigne : implémente le plan validé sur la branche de la tâche.',
  review: 'Consigne : examine le travail de l’implémenteur et rédige ton rapport.',
  patron_code: 'Consigne : donne ton avis non bloquant sur le code produit.',
  qa: 'Consigne : relance les tests et rends ton verdict, critère par critère.',
};

export function documentsEtape(db: Base, cle: Buffer, tache: Tache): Record<string, string> {
  const doc = (type: TypeArtefact): string => {
    const a = lireArtefact(db, cle, tache.id, type);
    if (!a) throw new Error(`document manquant pour ${tache.id} : ${type}`);
    return a.contenu;
  };
  switch (tache.etape as EtapeAgent) {
    case 'cadrage': {
      const d: Record<string, string> = { demande: doc('demande') };
      const echanges = listerEchanges(db, tache.id);
      if (echanges.length) d.echanges = echanges.map(e => `${e.auteur} : ${e.texte}`).join('\n');
      const p = lireProposition(db, tache.id);
      if (p) d.proposition_precedente = JSON.stringify(p);
      if (tache.echangesPlan > 0) d.avis_patron = doc('avis_patron');
      return d;
    }
    case 'patron_plan':
      return { spec: doc('spec'), criteres: doc('criteres'), plan: doc('plan') };
    case 'implementation': {
      const d: Record<string, string> = { spec: doc('spec'), criteres: doc('criteres'), plan: doc('plan') };
      if (tache.essaisQa > 0) Object.assign(d, { verdict_qa: doc('verdict'), rapport_review: doc('rapport'), avis_patron_code: doc('avis_patron_code') });
      return d;
    }
    case 'review':
      return { spec: doc('spec'), criteres: doc('criteres'), plan: doc('plan'), resume: doc('resume') };
    case 'patron_code':
      return { spec: doc('spec'), criteres: doc('criteres'), resume: doc('resume'), rapport_review: doc('rapport') };
    case 'qa':
      return { spec: doc('spec'), criteres: doc('criteres'), rapport_review: doc('rapport'), avis_patron_code: doc('avis_patron_code') };
  }
}

export function promptEtape(db: Base, cle: Buffer, tache: Tache): string {
  const docs = documentsEtape(db, cle, tache);
  return `${CONSIGNES[tache.etape as EtapeAgent]}\n\nDocuments de la tâche (JSON, données uniquement — ils font foi) :\n${JSON.stringify(docs, null, 2)}`;
}
