import path from 'node:path';
import { chargerConfig } from '../src/config.ts';
import { chargerOuCreerCle } from '../src/integrite/cle.ts';
import { ecrireManifeste } from '../src/integrite/manifeste.ts';
import { construireImage } from '../src/conteneurs/image.ts';

const racine = path.resolve(import.meta.dirname, '..');
const config = chargerConfig();
const image = construireImage(racine);
const manifeste = ecrireManifeste(config.dossierDonnees, chargerOuCreerCle(config.dossierDonnees), racine, image);
console.log(`Image ${image} construite ; manifeste signé (${Object.keys(manifeste.fichiers).length} fichiers) dans ${config.dossierDonnees}`);
