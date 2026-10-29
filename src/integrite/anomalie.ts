export class AnomalieIntegrite extends Error {
  readonly artefact: string;
  constructor(artefact: string, message: string) {
    super(message);
    this.name = 'AnomalieIntegrite';
    this.artefact = artefact;
  }
}
