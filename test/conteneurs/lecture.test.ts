import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Docker from 'dockerode';
import { lireFichierVolume, PLAFOND_ANALYSE, PLAFOND_LECTURE } from '../../src/conteneurs/docker.ts';

/** Trame stdout du flux multiplexé de Docker. */
const trame = (contenu: Buffer) => {
  const entete = Buffer.alloc(8);
  entete[0] = 1;
  entete.writeUInt32BE(contenu.length, 4);
  return Buffer.concat([entete, contenu]);
};

/** Docker minimal : le conteneur jetable de lecture « sort » le contenu donné. */
function fauxDocker(contenu: Buffer) {
  const commandes: string[][] = [];
  const docker = {
    createContainer: async (o: Docker.ContainerCreateOptions) => {
      commandes.push(o.Cmd as string[]);
      // `head -c N` ne sort jamais plus de N octets : la sortie simulée respecte la limite demandée.
      const limite = Number((o.Cmd as string[]).at(-1));
      return {
        start: async () => {}, wait: async () => ({ StatusCode: 0 }), remove: async () => {},
        logs: async () => trame(contenu.subarray(0, limite)),
      };
    },
  };
  return { docker: docker as unknown as Docker, commandes };
}

test('plafonds de lecture : 5 Mo par défaut, 64 Mo pour l’analyse', () => {
  assert.equal(PLAFOND_LECTURE, 5 * 1024 ** 2);
  assert.equal(PLAFOND_ANALYSE, 64 * 1024 ** 2);
});

test('fichier au plafond : lu entier ; un octet de plus : null, jamais tronqué', async () => {
  const pile = fauxDocker(Buffer.alloc(PLAFOND_LECTURE, 'a'));
  assert.equal((await lireFichierVolume(pile.docker, 'img', 'v', '/workspace/f'))?.length, PLAFOND_LECTURE);
  const trop = fauxDocker(Buffer.alloc(PLAFOND_LECTURE + 1, 'a'));
  assert.equal(await lireFichierVolume(trop.docker, 'img', 'v', '/workspace/f'), null);
  assert.equal(trop.commandes[0].at(-1), String(PLAFOND_LECTURE + 1), 'lecture de plafond + 1 octets');
});

test('plafond paramétrable : 6 Mo lus sous le plafond d’analyse, refusés au-delà', async () => {
  const six = Buffer.alloc(6 * 1024 ** 2, 'b');
  assert.equal((await lireFichierVolume(fauxDocker(six).docker, 'img', 'v', '/workspace/f', PLAFOND_ANALYSE))?.length, six.length);
  assert.equal(await lireFichierVolume(fauxDocker(six).docker, 'img', 'v', '/workspace/f'), null);
  const trop = fauxDocker(Buffer.alloc(PLAFOND_ANALYSE + 1, 'c'));
  assert.equal(await lireFichierVolume(trop.docker, 'img', 'v', '/workspace/f', PLAFOND_ANALYSE), null);
  assert.equal(trop.commandes[0].at(-1), String(PLAFOND_ANALYSE + 1));
});

test('lecture du gardien : au-delà du plafond, les premiers octets restent contrôlés (comportement antérieur conservé)', async () => {
  // Un null ferait sauter le contrôle du contenu d'un script exécuté et figerait l'empreinte d'un fichier modifié.
  const gros = Buffer.concat([Buffer.from('rm -rf /\n'), Buffer.alloc(PLAFOND_LECTURE, 'a')]);
  const lu = await lireFichierVolume(fauxDocker(gros).docker, 'img', 'v', '/workspace/f', PLAFOND_LECTURE, 'tronquer');
  assert.equal(lu?.length, PLAFOND_LECTURE);
  assert.ok(lu?.startsWith('rm -rf /'));
});
