import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lignesModifiees } from '../../src/analyse/diff.ts';

const PATCH = `diff --git a/src/Film.cs b/src/Film.cs
index 1..2 100644
--- a/src/Film.cs
+++ b/src/Film.cs
@@ -10,0 +11,2 @@ public class Film
+  public string Titre { get; set; }
+  public string Synopsis { get; set; }
@@ -20 +22 @@ public class Film
-  return x;
+  return y;
@@ -30,2 +32,0 @@
-  a
-  b
diff --git a/vieux.txt b/vieux.txt
deleted file mode 100644
--- a/vieux.txt
+++ /dev/null
@@ -1 +0,0 @@
-x
`;

test('lignes ajoutées et modifiées par fichier, suppressions ignorées', () => {
  const m = lignesModifiees(PATCH);
  assert.deepEqual([...m.keys()], ['src/Film.cs']);
  assert.deepEqual([...m.get('src/Film.cs')!].sort((a, b) => a - b), [11, 12, 22]);
});

test('diff vide', () => assert.equal(lignesModifiees('').size, 0));

test('une ligne ajoutée qui ressemble à un en-tête +++ n\'est pas prise pour un fichier', () => {
  const patch = `diff --git a/a.md b/a.md
--- a/a.md
+++ b/a.md
@@ -0,0 +1,2 @@
+++ b/faux.txt
+@@ -0,0 +50,3 @@
`;
  const m = lignesModifiees(patch);
  assert.deepEqual([...m.keys()], ['a.md']);
  assert.deepEqual([...m.get('a.md')!], [1, 2]);
});

test('chemin avec espace (tabulation finale) et chemin entre guillemets', () => {
  const patch = `diff --git a/mon fichier.cs b/mon fichier.cs
--- a/mon fichier.cs\t
+++ b/mon fichier.cs\t
@@ -0,0 +1 @@
+x
diff --git "a/\\303\\251.cs" "b/\\303\\251.cs"
--- "a/\\303\\251.cs"
+++ "b/\\303\\251.cs"
@@ -0,0 +3 @@
+y
`;
  const m = lignesModifiees(patch);
  assert.deepEqual([...m.keys()], ['mon fichier.cs', 'é.cs']);
});

test('diff réel du spike (git diff -U0)', () => {
  const m = lignesModifiees(fs.readFileSync('test/fixtures/analyse/diff.patch', 'utf8'));
  assert.deepEqual([...m.keys()].sort(), ['config/aws.env', 'src/Demo.Lib/Remise.cs']);
  assert.deepEqual([...m.get('src/Demo.Lib/Remise.cs')!].sort((a, b) => a - b), [1, 2, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25]);
  assert.deepEqual([...m.get('config/aws.env')!].sort((a, b) => a - b), [1, 2, 3]);
});
