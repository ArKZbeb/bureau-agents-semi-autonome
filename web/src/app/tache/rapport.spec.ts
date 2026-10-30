import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Analyse, Verdict } from '../modeles';
import { RapportVue } from './rapport';

const analyse = (o: Partial<Analyse> = {}): Analyse => ({
  sha: 'abc', base: 'main',
  outils: { tests_dotnet: 'ok', semgrep: 'ok', gitleaks: 'non_applicable', audit_npm: 'echec' },
  tests: { total: 10, echecs: 2 }, couverture: null, constats: [], signalements: [], ...o,
});

async function rendre(entrees: { analyse?: unknown; verdict?: unknown; rapport?: string | null }) {
  const f = TestBed.createComponent(RapportVue);
  const texte = (v: unknown) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  f.componentRef.setInput('donnees', { analyse: texte(entrees.analyse), verdict: texte(entrees.verdict), rapport: entrees.rapport ?? null });
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { el, texte: el.textContent!.replace(/\s+/g, ' ') };
}

describe('RapportVue', () => {
  it('analyse null : rapport en construction', async () => {
    const { texte } = await rendre({});
    expect(texte).toContain('Rapport en construction');
    expect(texte).toContain('Analyse pas encore faite.');
  });

  it('outil absent : mesure manquante sur la ligne Semgrep', async () => {
    const { el } = await rendre({ analyse: analyse({ outils: { semgrep: 'absent', gitleaks: 'ok' } }) });
    const ligne = [...el.querySelectorAll('tr')].find(tr => tr.textContent!.includes('Semgrep'))!;
    expect(ligne.textContent).toContain('✕ mesure manquante');
    const g = [...el.querySelectorAll('tr')].find(tr => tr.textContent!.includes('gitleaks'))!;
    expect(g.textContent).toContain('✓');
  });

  it('statuts échec et non applicable, tests verts', async () => {
    const { texte } = await rendre({ analyse: analyse() });
    expect(texte).toContain('✕ échec');
    expect(texte).toContain('— non applicable');
    expect(texte).toContain('8 / 10 verts');
  });

  it('couverture et sources hors couverture', async () => {
    const { texte } = await rendre({ analyse: analyse({ couverture: { couvertes: 142, total: 161, pourcentage: 88.2, sourcesHorsCouverture: ['src/A.cs'] } }) });
    expect(texte).toContain('Couverture des lignes modifiées : 88.2 % (142 / 161)');
    expect(texte).toContain('Hors couverture :');
    expect(texte).toContain('src/A.cs');
  });

  it('couverture non mesurable', async () => {
    const { texte } = await rendre({ analyse: analyse({ couverture: null }) });
    expect(texte).toContain('non mesurable');
  });

  it('failles par sévérité, constats, signalements et absence de triche', async () => {
    const { texte } = await rendre({ analyse: analyse({ constats: [{ outil: 'semgrep', severite: 'haute', message: 'injection SQL', fichier: 'src/B.cs' }] }) });
    expect(texte).toContain('Failles par sévérité');
    expect(texte).toContain('haute · injection SQL · src/B.cs');
    expect(texte).toContain('Signes de triche : aucun');
    const avec = await rendre({ analyse: analyse({ signalements: ['test désactivé'] }) });
    expect(avec.texte).toContain('Signalements');
    expect(avec.texte).toContain('test désactivé');
    expect(avec.texte).not.toContain('Signes de triche : aucun');
  });

  it('verdict no-go avec règle', async () => {
    const v: Verdict = { qa: { verdict: 'no_go', criteres: [{ numero: 1, rempli: false, preuve: 'rien' }] }, regles: ['couverture des lignes modifiées 70 % < 80 %'], verdict: 'no_go' };
    const { el, texte } = await rendre({ verdict: v });
    expect(texte).toContain('Verdict QA : NO-GO');
    expect(el.querySelector('.nogo')).not.toBeNull();
    expect(texte).toContain('couverture des lignes modifiées 70 % < 80 %');
    expect(texte).toContain('✕ C1 · Preuve : rien');
  });

  it('verdict go sans règle', async () => {
    const v: Verdict = { qa: { verdict: 'go', criteres: [{ numero: 2, rempli: true, preuve: 'test ok' }] }, regles: [], verdict: 'go' };
    const { el, texte } = await rendre({ verdict: v });
    expect(texte).toContain('Verdict QA : GO');
    expect(el.querySelector('.go')).not.toBeNull();
    expect(texte).toContain('aucune condition de no-go déclenchée');
    expect(texte).toContain('✓ C2 · Preuve : test ok');
  });

  it('JSON illisible : Document illisible', async () => {
    const { texte } = await rendre({ verdict: '{', analyse: '{' });
    expect(texte).toContain('Document illisible');
  });

  it('JSON valide mais de mauvaise forme : Document illisible, sans exception', async () => {
    const { texte } = await rendre({ verdict: '42', analyse: '{"outils": 3}' });
    expect(texte).toContain('Document illisible');
  });

  it('texte du reviewer sous son titre', async () => {
    const { texte } = await rendre({ rapport: 'Tout va bien' });
    expect(texte).toContain('Rapport du reviewer');
    expect(texte).toContain('Tout va bien');
  });

  it('un message de constat est rendu comme texte', async () => {
    const { el, texte } = await rendre({ analyse: analyse({ constats: [{ outil: 'semgrep', severite: 'basse', message: '<img src=x onerror=alert(1)>', fichier: null }] }) });
    expect(el.querySelector('img')).toBeNull();
    expect(texte).toContain('<img src=x onerror=alert(1)>');
  });

  it('éléments imbriqués invalides : Document illisible, sans exception', async () => {
    const a = await rendre({ analyse: '{"outils":{},"constats":[null],"signalements":[],"tests":null,"couverture":null}' });
    expect(a.texte).toContain('Document illisible');
    const v = await rendre({ verdict: '{"qa":{"verdict":"go","criteres":[null]},"regles":[],"verdict":"go"}' });
    expect(v.texte).toContain('Document illisible');
  });

  it('tests null : mesure manquante', async () => {
    const { texte } = await rendre({ analyse: analyse({ tests: null }) });
    expect(texte).toContain('Tests : mesure manquante');
  });
});
