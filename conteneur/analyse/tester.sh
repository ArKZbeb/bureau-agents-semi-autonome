#!/bin/bash
# Tests, couverture et audit .NET de la copie de contrôle, lancés par l'orchestrateur APRÈS mesurer.sh. Usage : tester.sh
# Exécute le code du dépôt (restauration NuGet et MSBuild, build, tests, Karma) dans la copie en écriture : ses
# résultats peuvent être falsifiés par ce code (limite assumée, spike E21). Ce conteneur ne voit jamais /mesures.
# Chaque outil écrit OUTIL.code (code de retour) ou OUTIL.na (non applicable) dans /workspace/analyse.
set -u
SORTIE=/workspace/analyse
PROJET=/workspace/projet
export HOME=/workspace/.analyse-home DOTNET_CLI_HOME=/workspace/.analyse-home NUGET_PACKAGES=/workspace/.analyse-home/nuget
export npm_config_cache=/workspace/.analyse-home/npm npm_config_ignore_scripts=true npm_config_update_notifier=false
export npm_config_registry=https://registry.npmjs.org/ npm_config_include=dev,optional,peer CHROME_BIN=/opt/analyse/chromium-conteneur
rm -rf "$SORTIE" "$HOME" && mkdir -p "$SORTIE" "$HOME" || exit 3
cd "$PROJET" || exit 3
git config --global safe.directory '*'

code() { echo "$2" > "$SORTIE/$1.code"; }
na() { : > "$SORTIE/$1.na"; }

# Fichier le moins profond qui répond aux critères find (CIBLE) ; 1 : aucun ; 2 : plusieurs à cette profondeur.
cible_unique() {
  local -a lignes=()
  mapfile -d '' -t lignes < <(find . \( -name node_modules -o -name .git \) -prune -o -type f \( "$@" \) -printf '%d %p\0' | sort -z -n)
  [ ${#lignes[@]} -gt 0 ] || return 1
  [ ${#lignes[@]} -eq 1 ] || [ "${lignes[1]%% *}" != "${lignes[0]%% *}" ] || return 2
  CIBLE=${lignes[0]#* }
}

# .NET : la solution la moins profonde, sinon le projet le moins profond ; ambiguïté = mesure manquante.
cible_unique -name '*.sln' -o -name '*.slnx'; ETAT=$?
[ $ETAT -eq 1 ] && { cible_unique -name '*.csproj'; ETAT=$?; }
if [ $ETAT -eq 1 ]; then
  na tests_dotnet; na audit_dotnet
elif [ $ETAT -eq 2 ]; then
  echo "plusieurs solutions ou projets .NET à la même profondeur" > "$SORTIE/dotnet-test.log"
  code tests_dotnet 3; code audit_dotnet 3
elif [[ ! "$CIBLE" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  # Le chemin est repris dans la ligne de commande passée à dotnet-coverage : caractères sûrs seulement.
  echo "chemin de solution refusé : $CIBLE" > "$SORTIE/dotnet-test.log"
  code tests_dotnet 3; code audit_dotnet 3
else
  timeout 1800 dotnet restore "$CIBLE" > "$SORTIE/dotnet-restore.log" 2>&1
  timeout 1800 dotnet-coverage collect -f cobertura -o "$SORTIE/dotnet.cobertura.xml" \
    "dotnet test $CIBLE --no-restore --logger trx;LogFileName=$SORTIE/dotnet.trx" > "$SORTIE/dotnet-test.log" 2>&1
  code tests_dotnet $?
  # Source imposée (pas celles du NuGet.config du dépôt). Code 0 même avec des vulnérabilités ; hors réseau,
  # la sortie n'est pas du JSON et le lecteur la rejette.
  timeout 600 dotnet list "$CIBLE" package --vulnerable --include-transitive --source https://api.nuget.org/v3/index.json --format json \
    > "$SORTIE/dotnet-vulnerables.json" 2> "$SORTIE/dotnet-vulnerables.log"
  code audit_dotnet $?
fi

# Angular : l'angular.json le moins profond ; ambiguïté = mesure manquante.
cible_unique -name angular.json; ETAT=$?
if [ $ETAT -eq 1 ]; then
  na tests_angular
elif [ $ETAT -eq 2 ]; then
  echo "plusieurs angular.json à la même profondeur" > "$SORTIE/angular-test.log"
  code tests_angular 3
else
  DOSSIER=$(dirname "$CIBLE")
  # Builder de la cible test du premier projet qui en a une : il fixe les options de couverture.
  CIBLE_NG=$(node -e '
    const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const [nom, p] of Object.entries(a.projects ?? {})) {
      const t = (p.architect ?? p.targets ?? {}).test;
      if (t && /^[A-Za-z0-9@][A-Za-z0-9@/._-]*$/.test(nom) && typeof t.builder === "string") { console.log(nom + " " + t.builder); process.exit(0); }
    }
    process.exit(1);' "$CIBLE" 2> "$SORTIE/angular-test.log")
  case "${CIBLE_NG#* }" in
    @angular/build:unit-test) OPTIONS_NG=(--coverage --runner-config /opt/analyse/karma.conf.cjs) ;;
    *:karma) OPTIONS_NG=(--code-coverage --karma-config /opt/analyse/karma.conf.cjs) ;;
    *) OPTIONS_NG=() ;;
  esac
  if [ ${#OPTIONS_NG[@]} -eq 0 ]; then
    echo "cible test Angular introuvable ou builder non pris en charge : ${CIBLE_NG:-aucune}" >> "$SORTIE/angular-test.log"
    code tests_angular 3
  else
    ( cd "$DOSSIER" && timeout 1800 npm ci --ignore-scripts > "$SORTIE/npm-ci.log" 2>&1 \
      && timeout 1800 npx --no-install ng test "${CIBLE_NG%% *}" --watch=false "${OPTIONS_NG[@]}" > "$SORTIE/angular-test.log" 2>&1 )
    code tests_angular $?
  fi
  [ -f "$SORTIE/angular-couverture/cobertura.xml" ] && cp "$SORTIE/angular-couverture/cobertura.xml" "$SORTIE/angular.cobertura.xml"
fi
exit 0
