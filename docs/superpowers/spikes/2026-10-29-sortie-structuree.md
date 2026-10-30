# Spike : sortie structurée de Claude Code derrière le gardien

Date : 2026-10-29. Banc : image de l'agent (`npm run image`, manifeste dans un dossier de données dédié),
fausse API Anthropic (flux SSE) sur un réseau Docker dédié, `claude -p --output-format stream-json --verbose
--json-schema <schéma> --max-turns 3`, conteneur en lecture seule avec le hook PreToolUse du gardien
(`onFailure: block`). Aucun appel API réel. Le gardien « joignable » est un petit serveur HTTP qui répond `allow`
(alias réseau `passerelle`, port 4311).

## Résultats

- **H1 confirmée.** L'outil exposé au modèle s'appelle exactement `StructuredOutput` (liste vue par l'API :
  `Agent, Bash, Edit, ListAgents, Read, ReportFindings, ScheduleWakeup, Skill, StructuredOutput, ToolSearch, Workflow,
  DeferredToolPlaceholder, Write`). Son entrée est l'objet JSON demandé (`{"resume":"ok"}`).
- **H2 confirmée.** L'appel à `StructuredOutput` passe par le hook PreToolUse (matcher `*`).
  - Gardien injoignable : l'appel est bloqué. Le `tool_result` est une erreur :
    `PreToolUse:StructuredOutput hook error: [...hook-gardien.mjs]: gardien injoignable ou réponse invalide : fetch failed`.
    Claude Code relance alors le modèle avec un message synthétique
    `[structured-output-enforce] You MUST call the StructuredOutput tool...`, puis la session s'arrête sans sortie structurée.
  - Gardien joignable répondant `allow` : l'appel est accepté (`permission_decision: accept, source: hook`),
    `tool_result` = `Structured output provided successfully`. Le gardien reçoit donc bien cet appel : sa liste blanche
    doit autoriser `StructuredOutput`.
- **H3 confirmée** (cas autorisé). La ligne `result` contient `structured_output` (objet validé) et `result` (même objet sérialisé) :

```json
{"type":"result","subtype":"success","is_error":false,"stop_reason":"tool_use","terminal_reason":"completed",
 "num_turns":2,"result":"{\"resume\":\"ok\"}","structured_output":{"resume":"ok"}, "...":"..."}
```

  Dans le cas bloqué, la ligne `result` ne contient pas `structured_output` (pas de réussite structurée).

## Conséquences pour la Task 2

- `OUTIL_SORTIE = 'StructuredOutput'` : aucune correction.
- Lire `structured_output` dans la ligne `result` ; l'absence de ce champ (ou `is_error`) = échec de l'étape.
- Le gardien (liste blanche) doit autoriser l'outil `StructuredOutput`, sinon l'agent ne peut jamais rendre son résultat.
- Détail : `stop_reason` vaut `tool_use` dans la ligne `result` du cas réussi ; ne pas s'en servir comme signal d'échec.
