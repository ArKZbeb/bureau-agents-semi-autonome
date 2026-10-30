import { Routes } from '@angular/router';
import { Hall } from './hall/hall';
import { TacheVue } from './tache/tache';

export const routes: Routes = [{ path: '', component: Hall }, { path: 'taches/:id', component: TacheVue }, { path: '**', redirectTo: '' }];
