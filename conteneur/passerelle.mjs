// Relais TCP : seul pont entre les réseaux internes des tâches et l'orchestrateur (host.docker.internal).
import net from 'node:net';

const PORT_INTERNE = 4311;
const port = Number(process.env.PORT_ORCHESTRATEUR);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT_ORCHESTRATEUR doit être un entier entre 1 et 65535');
  process.exit(1);
}

net
  .createServer(client => {
    const amont = net.connect(port, 'host.docker.internal');
    client.pipe(amont).pipe(client);
    amont.on('error', () => client.destroy());
    client.on('error', () => amont.destroy());
  })
  .listen(PORT_INTERNE, '0.0.0.0');
