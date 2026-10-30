import path from 'node:path';
import { chargerConfig } from './config.ts';
import { demarrerOrchestrateur } from './orchestrateur.ts';

try {
  const o = await demarrerOrchestrateur({ config: chargerConfig(), racineDepot: path.resolve(import.meta.dirname, '..') });
  console.log(`Bureau d'agents prêt : ouvre ${o.urlPanneau}`);
  console.log('Le lien contient le jeton de session : ne le partage pas.');
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => void o.arreter().finally(() => process.exit(0)));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
