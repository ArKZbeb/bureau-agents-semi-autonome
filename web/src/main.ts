import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { rangerJetonDuFragment } from './app/jeton';

// Le jeton est rangé puis le fragment effacé de l'URL avant tout le reste.
rangerJetonDuFragment(location, sessionStorage, history);

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
