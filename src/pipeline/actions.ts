import type { Base } from '../db.ts';
import { enregistrerArtefact } from '../integrite/artefacts.ts';
import { ajouterAuJournal } from '../integrite/journal.ts';
import { appliquer, augmenterBudget, listerTaches, lireTache, type Tache } from '../taches/depot.ts';
import { RAISON_PROPOSITION } from '../taches/etats.ts';
import { ajouterEchange, lireProposition, supprimerProposition } from '../taches/echanges.ts';
import { numeroterCriteres } from './prompts.ts';

const raisonPause = (t: Tache) => (t.raison ?? '').split(' : ')[0];
const journaliser = (db: Base, cle: Buffer, tacheId: string, commande: string, raison: string) =>
  ajouterAuJournal(db, cle, { tacheId, type: 'decision', commande, couche: 'humain', decision: 'Autorisé', decideur: 'Moi', raison });

export function repondreCadreur(db: Base, cle: Buffer, tacheId: string, texte: string): Tache {
  if (!texte.trim()) throw new Error('réponse vide');
  const t = appliquer(db, tacheId, { type: 'reponse_cadrage' });
  ajouterEchange(db, tacheId, 'moi', texte.trim());
  journaliser(db, cle, tacheId, 'réponse au cadreur', texte.trim().slice(0, 200));
  return t;
}

export function validerCadrage(db: Base, cle: Buffer, tacheId: string): Tache {
  const p = lireProposition(db, tacheId);
  if (!p) throw new Error(`${tacheId} : aucune proposition du cadreur à valider`);
  const t = lireTache(db, tacheId);
  // État vérifié avant toute signature : un refus ne laisse aucun document signé.
  // (enregistrerArtefact et appliquer ouvrent chacun leur transaction ; BEGIN IMMEDIATE ne s'imbrique pas.)
  if (t.etape !== 'cadrage' || t.statut !== 'attente_humain' || t.raison !== RAISON_PROPOSITION) throw new Error(`${tacheId} n’attend pas ma validation`);
  enregistrerArtefact(db, cle, tacheId, 'spec', p.spec);
  enregistrerArtefact(db, cle, tacheId, 'criteres', numeroterCriteres(p.criteres));
  enregistrerArtefact(db, cle, tacheId, 'plan', p.plan);
  supprimerProposition(db, tacheId);
  const suivante = appliquer(db, tacheId, { type: 'validation_cadrage' });
  journaliser(db, cle, tacheId, 'validation de la spec et du plan', 'spec, critères et plan signés');
  return suivante;
}

export function arbitrer(db: Base, cle: Buffer, tacheId: string, choix: 'cadreur' | 'alternative'): Tache {
  const t = appliquer(db, tacheId, { type: 'arbitrage', choix });
  journaliser(db, cle, tacheId, 'arbitrage du plan', choix === 'cadreur' ? 'approche du cadreur conservée' : 'alternative du patron adoptée');
  return t;
}

export function continuerBudget(db: Base, cle: Buffer, tacheId: string, montantUsd: number): Tache {
  if (!(montantUsd > 0)) throw new Error('montant attendu : nombre positif');
  const t = lireTache(db, tacheId);
  if (t.statut !== 'en_pause' || raisonPause(t) !== 'budget') throw new Error(`${tacheId} n’est pas en pause budget`);
  augmenterBudget(db, tacheId, montantUsd);
  const suite = appliquer(db, tacheId, { type: 'reprise' });
  journaliser(db, cle, tacheId, 'budget augmenté', `+ ${montantUsd.toFixed(2)} $`);
  return suite;
}

export function reprendre(db: Base, cle: Buffer, tacheId: string): Tache {
  const t = lireTache(db, tacheId);
  const permis = t.statut === 'bloquee' || (t.statut === 'en_pause' && ['integrite', 'arret_global', 'erreur_api'].includes(raisonPause(t)));
  if (!permis) throw new Error(`${tacheId} ne se reprend pas ainsi (${t.statut}${t.raison ? ` : ${t.raison}` : ''})`);
  const suite = appliquer(db, tacheId, { type: 'reprise' });
  journaliser(db, cle, tacheId, 'reprise de la tâche', t.raison ?? t.statut);
  return suite;
}

/** Arrêt global (ordonnanceur déjà suspendu) : toute tâche prête ou en cours passe en pause arret_global. */
export function pauserPourArretGlobal(db: Base): string[] {
  const pausees: string[] = [];
  for (const t of listerTaches(db)) {
    if (t.statut !== 'prete' && t.statut !== 'en_cours') continue;
    appliquer(db, t.id, { type: 'pause', raison: 'arret_global', detail: 'arrêt global demandé' });
    pausees.push(t.id);
  }
  return pausees;
}

/** Reprise globale : l'ordonnanceur est réactivé ; chaque tâche reste en pause et se reprend à la main. */
export function journaliserRepriseGlobale(db: Base, cle: Buffer): void {
  journaliser(db, cle, '—', 'reprise globale', 'ordonnanceur réactivé ; chaque tâche en pause se reprend à la main');
}
