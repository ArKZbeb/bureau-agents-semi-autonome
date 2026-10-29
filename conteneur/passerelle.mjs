// Relais TCP : seul pont entre les réseaux internes des tâches et l'orchestrateur (127.0.0.1 sur l'hôte).
import net from 'node:net';

const port = Number(process.env.PORT_ORCHESTRATEUR);
net
  .createServer(client => {
    const amont = net.connect(port, 'host.docker.internal');
    client.pipe(amont).pipe(client);
    amont.on('error', () => client.destroy());
    client.on('error', () => amont.destroy());
  })
  .listen(port, '0.0.0.0');
