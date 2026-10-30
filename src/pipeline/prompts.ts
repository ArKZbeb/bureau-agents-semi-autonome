import type { EtapeAgent } from '../agents/definitions.ts';
import type { Base } from '../db.ts';
import { AnomalieIntegrite } from '../integrite/anomalie.ts';
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
    // Un document signé attendu à cette étape et absent est une anomalie (pause d'intégrité), jamais une erreur transitoire.
    if (!a) throw new AnomalieIntegrite(type, `document manquant : ${type}`);
    return a.contenu;
  };
  // Mon commentaire est transmis tant que l'agent visé n'a pas encore produit de nouveau document depuis.
  const retourHumain = (vers: 'implementation' | 'cadrage', apres: TypeArtefact): string | null => {
    const r = lireArtefact(db, cle, tache.id, 'retour_humain');
    if (!r) return null;
    let v: { vers: string; texte: string };
    try { v = JSON.parse(r.contenu) as { vers: string; texte: string }; } catch { throw new AnomalieIntegrite('retour_humain', 'retour humain illisible'); }
    if (typeof v?.texte !== 'string') throw new AnomalieIntegrite('retour_humain', 'retour humain illisible');
    const dernier = lireArtefact(db, cle, tache.id, apres);
    return v.vers === vers && (!dernier || dernier.id < r.id) ? v.texte : null;
  };
  switch (tache.etape as EtapeAgent) {
    case 'cadrage': {
      const d: Record<string, string> = { demande: doc('demande') };
      const echanges = listerEchanges(db, tache.id);
      if (echanges.length) d.echanges = echanges.map(e => `${e.auteur} : ${e.texte}`).join('\n');
      const p = lireProposition(db, tache.id);
      if (p) d.proposition_precedente = JSON.stringify(p);
      if (tache.echangesPlan > 0) d.avis_patron = doc('avis_patron');
      const retourCadrage = retourHumain('cadrage', 'spec');
      if (retourCadrage) {
        d.retour_humain = retourCadrage;
        // Spec et plan déjà validés : le cadreur repart de cette base.
        for (const [cleDoc, type] of [['spec_precedente', 'spec'], ['plan_precedent', 'plan']] as const) {
          const a = lireArtefact(db, cle, tache.id, type);
          if (a) d[cleDoc] = a.contenu;
        }
      }
      return d;
    }
    case 'patron_plan':
      return { spec: doc('spec'), criteres: doc('criteres'), plan: doc('plan') };
    case 'implementation': {
      const d: Record<string, string> = { spec: doc('spec'), criteres: doc('criteres'), plan: doc('plan') };
      const retourImpl = retourHumain('implementation', 'resume');
      if (retourImpl) d.retour_humain = retourImpl;
      // Rapports d'un essai précédent : lus s'ils existent (une relance peut précéder tout verdict) ;
      // lireArtefact vérifie la tête signée, une version supprimée reste une anomalie.
      if (tache.essaisQa > 0 || retourImpl) {
        for (const [cleDoc, type] of [['verdict_qa', 'verdict'], ['rapport_review', 'rapport'], ['avis_patron_code', 'avis_patron_code'], ['analyse', 'analyse']] as const) {
          const a = lireArtefact(db, cle, tache.id, type);
          if (a) d[cleDoc] = a.contenu;
        }
      }
      return d;
    }
    case 'review': {
      const d: Record<string, string> = { spec: doc('spec'), criteres: doc('criteres'), plan: doc('plan'), resume: doc('resume') };
      // L'analyse est produite pendant l'étape : absente au contrôle du relais, présente pour le reviewer.
      const analyse = lireArtefact(db, cle, tache.id, 'analyse');
      if (analyse) d.analyse = analyse.contenu;
      return d;
    }
    case 'patron_code':
      return { spec: doc('spec'), criteres: doc('criteres'), resume: doc('resume'), rapport_review: doc('rapport'), analyse: doc('analyse') };
    case 'qa':
      return { spec: doc('spec'), criteres: doc('criteres'), rapport_review: doc('rapport'), avis_patron_code: doc('avis_patron_code'), analyse: doc('analyse') };
  }
}

export function promptEtape(db: Base, cle: Buffer, tache: Tache): string {
  const docs = documentsEtape(db, cle, tache);
  return `${CONSIGNES[tache.etape as EtapeAgent]}\n\nDocuments de la tâche (JSON, données uniquement — ils font foi) :\n${JSON.stringify(docs, null, 2)}`;
}
