import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { APP_BASE_HREF } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { JETON } from './api';
import { lireJeton } from './jeton';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    // Pas de <base> : la CSP (base-uri 'none') le ferait ignorer ; la base du routeur est donnée ici.
    { provide: APP_BASE_HREF, useValue: '/' },
    { provide: JETON, useFactory: () => lireJeton(location.hash, sessionStorage) ?? '' },
  ],
};
