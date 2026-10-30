import { Routes } from '@angular/router';
import { Hall } from './hall/hall';

export const routes: Routes = [{ path: '', component: Hall }, { path: '**', redirectTo: '' }];
