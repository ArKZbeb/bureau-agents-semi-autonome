// Hook PreToolUse : transmet l'appel au gardien de l'orchestrateur. Toute erreur bloque l'appel (exit 2).
const bloquer = raison => {
  process.stderr.write(`gardien injoignable ou réponse invalide : ${raison}\n`);
  process.exit(2);
};

try {
  let entree = '';
  for await (const morceau of process.stdin) entree += morceau;
  const r = await fetch(process.env.BUREAU_URL_GARDIEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.BUREAU_JETON}` },
    body: entree,
    signal: AbortSignal.timeout(80_000),
  });
  if (!r.ok) bloquer(`HTTP ${r.status}`);
  const sortie = await r.json();
  if (!['allow', 'deny', 'defer'].includes(sortie?.hookSpecificOutput?.permissionDecision)) bloquer('décision absente');
  process.stdout.write(JSON.stringify(sortie));
} catch (e) {
  bloquer(e.message);
}
