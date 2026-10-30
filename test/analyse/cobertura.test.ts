import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { couvertureLignesModifiees, lireCobertura } from '../../src/analyse/cobertura.ts';
import { lignesModifiees } from '../../src/analyse/diff.ts';

const XML = `<?xml version="1.0"?>
<coverage line-rate="0.5"><sources><source>/workspace/projet/</source></sources>
<packages><package name="Film"><classes>
<class name="Film" filename="src/Film.cs"><lines>
<line number="11" hits="3"/><line number="12" hits="0"/><line number="22" hits="1"/>
</lines><methods><method name="M"><lines><line number="11" hits="3"/></lines></method></methods></class>
</classes></package></packages></coverage>`;

test('Cobertura : chemins relatifs, passages par ligne', () => {
  const c = lireCobertura(XML);
  assert.deepEqual([...c.keys()], ['src/Film.cs']);
  assert.deepEqual([...c.get('src/Film.cs')!.entries()].sort((a, b) => a[0] - b[0]), [[11, 3], [12, 0], [22, 1]]);
});

test('Cobertura : chemin absolu sans <source> ramené au dépôt', () => {
  const c = lireCobertura('<coverage><class filename="/workspace/projet/src/A.ts"><line number="1" hits="1"/></class></coverage>');
  assert.deepEqual([...c.keys()], ['src/A.ts']);
});

test('Cobertura : filename relatif à un <source> sous-dossier (Angular) est joint, pas retiré', () => {
  const c = lireCobertura('<coverage><sources><source>/workspace/projet/front</source></sources><class filename="src/app/x.ts"><line number="3" hits="1"/></class></coverage>');
  assert.deepEqual([...c.keys()], ['front/src/app/x.ts']);
});

test('Cobertura : attributs hits avant number acceptés', () => {
  const c = lireCobertura('<coverage><class filename="/workspace/projet/a.ts"><line hits="2" number="4"/></class></coverage>');
  assert.deepEqual([...c.get('a.ts')!.entries()], [[4, 2]]);
});

test('couverture des lignes modifiées : seules les lignes instrumentées comptent', () => {
  const modifiees = new Map([['src/Film.cs', new Set([11, 12, 22, 99])], ['README.md', new Set([1])]]);
  assert.deepEqual(couvertureLignesModifiees(modifiees, [lireCobertura(XML)]), { couvertes: 2, total: 3, pourcentage: 67 });
});

test('aucune ligne modifiée instrumentée : non mesurable', () => {
  assert.deepEqual(couvertureLignesModifiees(new Map([['README.md', new Set([1])]]), [lireCobertura(XML)]), { couvertes: 0, total: 0, pourcentage: null });
});

test('les fichiers de test ne comptent pas dans la couverture (assemblies de test instrumentées)', () => {
  const xml = `<coverage><class filename="/workspace/projet/tests/Demo.Tests/RemiseTests.cs"><line number="5" hits="4"/></class>
<class filename="/workspace/projet/src/A.cs"><line number="1" hits="0"/></class></coverage>`;
  const modifiees = new Map([['tests/Demo.Tests/RemiseTests.cs', new Set([5])], ['src/A.cs', new Set([1])]]);
  assert.deepEqual(couvertureLignesModifiees(modifiees, [lireCobertura(xml)]), { couvertes: 0, total: 1, pourcentage: 0 });
});

test('sorties réelles du spike lisibles', () => {
  for (const f of ['dotnet.cobertura.xml', 'angular.cobertura.xml']) {
    const chemin = `test/fixtures/analyse/${f}`;
    assert.ok(lireCobertura(fs.readFileSync(chemin, 'utf8')).size > 0, f);
  }
});

test('spike : 1 / 7 = 14 % sur les lignes modifiées réelles (.NET, BOM, tests exclus)', () => {
  const modifiees = lignesModifiees(fs.readFileSync('test/fixtures/analyse/diff.patch', 'utf8'));
  const dotnet = lireCobertura(fs.readFileSync('test/fixtures/analyse/dotnet.cobertura.xml', 'utf8'));
  assert.deepEqual([...dotnet.keys()].sort(), ['src/Demo.Lib/Remise.cs', 'tests/Demo.Tests/RemiseTests.cs']);
  assert.deepEqual(couvertureLignesModifiees(modifiees, [dotnet]), { couvertes: 1, total: 7, pourcentage: 14 });
});

test('spike : Angular, chemins joints à <source> /workspace/front', () => {
  const angular = lireCobertura(fs.readFileSync('test/fixtures/analyse/angular.cobertura.xml', 'utf8'));
  assert.deepEqual([...angular.keys()].sort(), ['/workspace/front/src/app/app.html', '/workspace/front/src/app/app.ts', '/workspace/front/src/app/remise.ts']);
});

test('projets de test .NET (Demo.Tests/, Demo.Test/) exclus, Demo/ compté', () => {
  const xml = `<coverage><class filename="/workspace/projet/Demo.Tests/Fakes.cs"><line number="1" hits="1"/></class>
<class filename="/workspace/projet/Demo.Test/F.cs"><line number="1" hits="1"/></class>
<class filename="/workspace/projet/Demo/Service.cs"><line number="1" hits="0"/></class></coverage>`;
  const modifiees = new Map([['Demo.Tests/Fakes.cs', new Set([1])], ['Demo.Test/F.cs', new Set([1])], ['Demo/Service.cs', new Set([1])]]);
  assert.deepEqual(couvertureLignesModifiees(modifiees, [lireCobertura(xml)]), { couvertes: 0, total: 1, pourcentage: 0 });
});

test('<class /> auto-fermante n\'absorbe pas la classe suivante', () => {
  const c = lireCobertura(`<coverage><class filename="/workspace/projet/a.cs" />
<class filename="/workspace/projet/b.cs"><line number="2" hits="1"/></class></coverage>`);
  assert.deepEqual(c.get('a.cs') === undefined ? [] : [...c.get('a.cs')!], []);
  assert.deepEqual([...c.get('b.cs')!], [[2, 1]]);
});
