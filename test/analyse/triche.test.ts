import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signesDeTriche } from '../../src/analyse/triche.ts';

const PATCH = `diff --git a/tests/FusionTests.cs b/tests/FusionTests.cs
--- a/tests/FusionTests.cs
+++ b/tests/FusionTests.cs
@@ -10,3 +10,2 @@
-    [Fact]
-    public void Fusion_GardeLesRemises() {}
+    [Fact(Skip = "temporaire")]
diff --git a/src/app/devis.spec.ts b/src/app/devis.spec.ts
--- a/src/app/devis.spec.ts
+++ b/src/app/devis.spec.ts
@@ -1 +1 @@
-  it('compare', () => {});
+  fit('compare', () => {});
diff --git a/karma.conf.js b/karma.conf.js
--- a/karma.conf.js
+++ b/karma.conf.js
@@ -5 +5 @@
-  check: { global: { lines: 80 } }
+  check: { global: { lines: 10 } }
diff --git a/src/Film.cs b/src/Film.cs
--- a/src/Film.cs
+++ b/src/Film.cs
@@ -1 +1 @@
-  // it( dans du code de prod
+  // rien
`;

test('tests supprimés, désactivés, isolés, configuration modifiée', () => {
  assert.deepEqual(signesDeTriche(PATCH), [
    'test supprimé dans tests/FusionTests.cs',
    'test désactivé dans tests/FusionTests.cs',
    'test supprimé dans src/app/devis.spec.ts',
    'test isolé dans src/app/devis.spec.ts',
    'configuration de test ou de couverture modifiée : karma.conf.js',
  ]);
});

test('diff sans signe', () => assert.deepEqual(signesDeTriche(''), []));

const diff = (fichier: string, ...lignes: string[]) =>
  `diff --git a/${fichier} b/${fichier}\n--- a/${fichier}\n+++ b/${fichier}\n@@ -1 +1 @@\n${lignes.join('\n')}\n`;

test('contournement des outils d’analyse dans une ligne ajoutée', () => {
  assert.deepEqual(signesDeTriche(diff('src/Api.cs', '+// nosemgrep: rule')), ['contournement d’outil d’analyse dans src/Api.cs']);
  assert.deepEqual(signesDeTriche(diff('src/cfg.ts', '+const k = "x"; // gitleaks:allow')), ['contournement d’outil d’analyse dans src/cfg.ts']);
  assert.deepEqual(signesDeTriche(diff('src/Api.cs', '-// nosemgrep: rule')), []);
});

test('fichiers de configuration des outils d’analyse modifiés', () => {
  for (const f of ['.gitleaksignore', '.gitleaks.toml', '.semgrepignore', '.semgrep.yml', 'cfg/.semgrep.yaml', '.gitattributes']) {
    assert.deepEqual(signesDeTriche(diff(f, '+x')), [`fichier de configuration d’outil d’analyse modifié : ${f}`]);
  }
  assert.deepEqual(signesDeTriche(diff('docs/gitattributes.md', '+x')), []);
});

test('exclusions de couverture ajoutées', () => {
  for (const l of ['+[ExcludeFromCodeCoverage]', '+/* istanbul ignore next */', '+/* c8 ignore next */', '+/* v8 ignore next */',
    '+<CodeCoverageExclude>', '+<ExcludeByAttribute>X</ExcludeByAttribute>', '+<ExcludeByFile>**/*.cs</ExcludeByFile>', '+coverletExclude']) {
    assert.deepEqual(signesDeTriche(diff('src/A.cs', l)), ['exclusion de couverture ajoutée dans src/A.cs'], l);
  }
  assert.deepEqual(signesDeTriche(diff('src/A.cs', '-[ExcludeFromCodeCoverage]')), []);
});
