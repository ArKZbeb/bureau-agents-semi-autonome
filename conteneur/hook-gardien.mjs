// Hook PreToolUse : transmet l'appel au gardien de l'orchestrateur. Toute erreur bloque l'appel (exit 2).
// L'URL n'est pas lue dans l'environnement : des réglages utilisateur ne peuvent pas la rediriger.
const bloquer = raison => {
  process.stderr.write(`gardien injoignable ou réponse invalide : ${raison}\n`);
  process.exit(2);
};

const url = process.argv[2] ?? 'http://passerelle:4311/gardien';

try {
  const morceaux = [];
  for await (const morceau of process.stdin) morceaux.push(morceau);
  const entree = Buffer.concat(morceaux).toString('utf8');
  const r = await fetch(url, {
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
