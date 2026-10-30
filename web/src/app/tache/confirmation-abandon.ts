import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirmation-abandon',
  template: `
    <div class="voile"><section class="dialogue">
      <h2>Abandonner {{ id() }} ?</h2>
      <p>Abandonner {{ id() }} ? La branche n'est pas récupérée et l'espace de la tâche est supprimé.</p>
      <footer>
        <button (click)="annuler.emit()">Annuler</button>
        <button class="danger" [disabled]="occupe()" (click)="confirmer.emit()">Abandonner</button>
      </footer>
    </section></div>`,
})
export class ConfirmationAbandon {
  readonly id = input.required<string>();
  readonly occupe = input(false);
  readonly confirmer = output<void>();
  readonly annuler = output<void>();
}
