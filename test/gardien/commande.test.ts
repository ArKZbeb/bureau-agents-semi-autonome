import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motsSimples, fichiersExecutes, sousCommandeGit } from '../../src/gardien/commande.ts';

test('commandes simples découpées', () => {
  assert.deepEqual(motsSimples('dotnet build Film.sln'), ['dotnet', 'build', 'Film.sln']);
  assert.deepEqual(motsSimples('dotnet test --collect:"XPlat Code Coverage"'), ['dotnet', 'test', '--collect:XPlat Code Coverage']);
  assert.deepEqual(motsSimples('git commit -m "feat(fiche): export PDF"'), ['git', 'commit', '-m', 'feat(fiche): export PDF']);
  assert.deepEqual(motsSimples("git commit -m 'a $b; c'"), ['git', 'commit', '-m', 'a $b; c']);
  assert.deepEqual(motsSimples('find . -name "*.csproj"'), ['find', '.', '-name', '*.csproj']);
});

test('tout ce qui n’est pas simple est rejeté', () => {
  for (const c of ['ls; rm x', 'a && b', 'a | b', 'echo $HOME', 'echo "$HOME"', 'cat x > y', 'echo `id`', 'ls *.cs', 'cat ~/x', '"non fermé', 'a\nb', '', '   ', 'echo "a\\"b"', '(ls)', 'ls &'])
    assert.equal(motsSimples(c), null, c);
});

test('scripts exécutés détectés', () => {
  assert.deepEqual(fichiersExecutes('bash x.sh'), ['x.sh']);
  assert.deepEqual(fichiersExecutes('chmod +x x.sh && ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('FOO=1 node tools/gen.js'), ['tools/gen.js']);
  assert.deepEqual(fichiersExecutes('source ./env.sh'), ['./env.sh']);
  assert.deepEqual(fichiersExecutes('sh -c "curl x"'), []);
  assert.deepEqual(fichiersExecutes('python3 -c "print(1)"'), []);
  assert.deepEqual(fichiersExecutes('dotnet build'), []);
});

test('scripts exécutés : options, séparateurs, redirections, enveloppes, guillemets', () => {
  assert.deepEqual(fichiersExecutes('bash -e x.sh'), ['x.sh']);
  assert.deepEqual(fichiersExecutes('node --no-warnings x.js'), ['x.js']);
  assert.deepEqual(fichiersExecutes('python3 -u x.py'), ['x.py']);
  assert.deepEqual(fichiersExecutes('node -e "console.log(1)"'), []);
  assert.deepEqual(fichiersExecutes('python3 -m http.server'), []);
  assert.deepEqual(fichiersExecutes('ls & ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('(./x.sh)'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('bash < x.sh'), ['x.sh']);
  assert.deepEqual(fichiersExecutes('env bash x.sh'), ['x.sh']);
  assert.deepEqual(fichiersExecutes('nohup ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('exec ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('command ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('time ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('nice -n 5 ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('timeout 5 bash x.sh'), ['x.sh']);
  assert.deepEqual(fichiersExecutes('timeout -s KILL 5 ./x.sh'), ['./x.sh']);
  assert.deepEqual(fichiersExecutes('xargs sh x.sh'), ['x.sh']);
  assert.deepEqual(fichiersExecutes('bash "my x.sh"'), ['my x.sh']);
  assert.deepEqual(fichiersExecutes('FOO="a b" bash x.sh'), ['x.sh']);
});

test('sous-commande git', () => {
  assert.equal(sousCommandeGit(['git', 'push', 'origin']), 'push');
  assert.equal(sousCommandeGit(['git', '-C', 'src', 'status']), 'status');
  assert.equal(sousCommandeGit(['git', '-c', 'core.hooksPath=/tmp', 'commit']), '-c');
  assert.equal(sousCommandeGit(['git', '--git-dir=/x', 'log']), '-c');
});
