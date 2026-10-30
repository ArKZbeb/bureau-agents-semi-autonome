import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { lireJeton } from './app/jeton';

// Le jeton est rangé puis le fragment effacé de l'URL avant tout le reste.
if (location.hash.startsWith('#jeton=')) {
  lireJeton(location.hash, sessionStorage);
  history.replaceState(null, '', location.pathname + location.search);
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
