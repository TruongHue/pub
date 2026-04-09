import { Routes } from '@angular/router';

import { LandingPageComponent } from './pages/landing-page.component';
import { LivePageComponent } from './app';

export const routes: Routes = [
  { path: '', component: LandingPageComponent },
  { path: 'live', component: LivePageComponent },
  { path: '**', redirectTo: '' }
];
