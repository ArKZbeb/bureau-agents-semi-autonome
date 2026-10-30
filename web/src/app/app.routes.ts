import { Routes } from '@angular/router';
import { Bureau } from './bureau/bureau';
import { Hall } from './hall/hall';
import { Journal } from './securite/journal';
import { Securite } from './securite/securite';
import { TacheVue } from './tache/tache';

export const routes: Routes = [
  { path: '', component: Hall }, { path: 'taches/:id', component: TacheVue },
  { path: 'bureau', component: Bureau },
  { path: 'securite', component: Securite }, { path: 'journal', component: Journal },
  { path: '**', redirectTo: '' },
];
