export type Fin = {
  type: 'fin'; sessionId: string; sousType: string | null; stopReason: string | null; erreur: boolean;
  apiErrorStatus: number | null; resultat: string; differe: { id: string; nom: string; entree: unknown } | null;
};
export type EvenementFlux =
  | { type: 'init'; sessionId: string }
  | { type: 'outil'; id: string; nom: string; entree: unknown }
  | { type: 'resultat_outil'; id: string; contenu: string; erreur: boolean }
  | { type: 'texte'; texte: string }
  | Fin;

type Json = any;

export function lireLigne(ligne: string): EvenementFlux[] {
  let m: Json;
  try {
    m = JSON.parse(ligne);
  } catch {
    return [];
  }
  if (m?.type === 'system' && m.subtype === 'init') return [{ type: 'init', sessionId: m.session_id }];
  if (m?.type === 'assistant')
    return (m.message?.content ?? []).flatMap((b: Json): EvenementFlux[] =>
      b.type === 'tool_use' ? [{ type: 'outil', id: b.id, nom: b.name, entree: b.input }] : b.type === 'text' ? [{ type: 'texte', texte: b.text }] : []);
  if (m?.type === 'user' && Array.isArray(m.message?.content))
    return m.message.content
      .filter((b: Json) => b.type === 'tool_result')
      .map((b: Json): EvenementFlux => ({ type: 'resultat_outil', id: b.tool_use_id, contenu: typeof b.content === 'string' ? b.content : JSON.stringify(b.content), erreur: !!b.is_error }));
  if (m?.type === 'result') {
    const d = m.deferred_tool_use;
    return [{
      type: 'fin', sessionId: m.session_id, sousType: m.subtype ?? null, stopReason: m.stop_reason ?? null, erreur: !!m.is_error,
      apiErrorStatus: m.api_error_status ?? null, resultat: String(m.result ?? ''), differe: d ? { id: d.id, nom: d.name, entree: d.input } : null,
    }];
  }
  return [];
}

export function decoupeurLignes(surLigne: (l: string) => void): (morceau: Buffer) => void {
  const decodeur = new TextDecoder();
  let reste = '';
  return morceau => {
    reste += decodeur.decode(morceau, { stream: true });
    const lignes = reste.split('\n');
    reste = lignes.pop() ?? '';
    for (const l of lignes) if (l.trim()) surLigne(l);
  };
}
