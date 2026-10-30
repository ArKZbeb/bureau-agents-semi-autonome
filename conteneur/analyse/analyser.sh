#!/bin/bash
# Analyse de la copie de contrôle, lancée par l'orchestrateur (jamais par un agent). Usage : analyser.sh COMMIT_BASE
# Chaque outil écrit OUTIL.code (code de retour) ou OUTIL.na (non applicable) dans /workspace/analyse.
# Le dépôt est de la donnée : aucune de ses configurations ne peut masquer un constat (Semgrep, gitleaks, diff).
set -u
BASE="${1:-}"
SORTIE=/workspace/analyse
PROJET=/workspace/projet
export HOME=/workspace/.analyse-home DOTNET_CLI_HOME=/workspace/.analyse-home NUGET_PACKAGES=/workspace/.analyse-home/nuget
export npm_config_cache=/workspace/.analyse-home/npm npm_config_ignore_scripts=true CHROME_BIN=/opt/analyse/chromium-conteneur
export SEMGREP_ENABLE_VERSION_CHECK=0 SEMGREP_SEND_METRICS=off
# Résultats précédents effacés d'abord : un arrêt prématuré ne laisse aucune mesure périmée.
rm -rf "$SORTIE" "$HOME" && mkdir -p "$SORTIE" "$HOME" || exit 3
cd "$PROJET" || exit 3
git config --global safe.directory '*'
# Base vérifiée avant tout : avec une base absente, gitleaks renvoie 0 et « [] » (faux négatif).
case "$BASE" in *[!0-9a-f]*|'') echo "commit de base invalide" >&2; exit 3;; esac
git cat-file -e "$BASE^{commit}" 2>/dev/null || { echo "commit de base absent" >&2; exit 3; }

git rev-parse HEAD > "$SORTIE/sha"
# --text et sans pilote : un attribut « -diff » ou « binary » du dépôt ne cache pas de lignes modifiées.
git diff -U0 --text --no-ext-diff --no-textconv "$BASE..HEAD" > "$SORTIE/diff.patch"
git -c core.quotePath=false diff --name-only --diff-filter=d "$BASE..HEAD" > "$SORTIE/fichiers-modifies"

code() { echo "$2" > "$SORTIE/$1.code"; }
na() { : > "$SORTIE/$1.na"; }

# .NET : solution (ou projet) la plus proche de la racine.
CIBLE_DOTNET=$(find . -path ./node_modules -prune -o \( -name '*.sln' -o -name '*.slnx' \) -print | sort | head -n 1)
[ -z "$CIBLE_DOTNET" ] && CIBLE_DOTNET=$(find . -path ./node_modules -prune -o -name '*.csproj' -print | sort | head -n 1)
if [ -z "$CIBLE_DOTNET" ]; then
  na tests_dotnet; na audit_dotnet
elif [[ ! "$CIBLE_DOTNET" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  # Le chemin est repris dans la ligne de commande passée à dotnet-coverage : caractères sûrs seulement.
  echo "chemin de solution refusé : $CIBLE_DOTNET" > "$SORTIE/dotnet-test.log"
  code tests_dotnet 3; code audit_dotnet 3
else
  timeout 1800 dotnet restore "$CIBLE_DOTNET" > "$SORTIE/dotnet-restore.log" 2>&1
  timeout 1800 dotnet-coverage collect -f cobertura -o "$SORTIE/dotnet.cobertura.xml" \
    "dotnet test $CIBLE_DOTNET --no-restore --logger trx;LogFileName=$SORTIE/dotnet.trx" > "$SORTIE/dotnet-test.log" 2>&1
  code tests_dotnet $?
  # Code 0 même avec des vulnérabilités ; hors réseau, la sortie n'est pas du JSON et le lecteur la rejette.
  timeout 600 dotnet list "$CIBLE_DOTNET" package --vulnerable --include-transitive --format json > "$SORTIE/dotnet-vulnerables.json" 2> "$SORTIE/dotnet-vulnerables.log"
  code audit_dotnet $?
fi

# Angular : premier angular.json hors node_modules.
ANGULAR=$(find . -path ./node_modules -prune -o -name angular.json -print | sort | head -n 1)
if [ -z "$ANGULAR" ]; then
  na tests_angular; na audit_npm
else
  DOSSIER=$(dirname "$ANGULAR")
  # Builder de la cible test du premier projet qui en a une : il fixe les options de couverture.
  CIBLE_NG=$(node -e '
    const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const [nom, p] of Object.entries(a.projects ?? {})) {
      const t = (p.architect ?? p.targets ?? {}).test;
      if (t && /^[A-Za-z0-9@][A-Za-z0-9@/._-]*$/.test(nom) && typeof t.builder === "string") { console.log(nom + " " + t.builder); process.exit(0); }
    }
    process.exit(1);' "$ANGULAR" 2> "$SORTIE/angular-test.log")
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
  ( cd "$DOSSIER" && timeout 600 npm audit --json > "$SORTIE/npm-audit.json" 2> "$SORTIE/npm-audit.log" )
  # npm audit renvoie 1 avec des vulnérabilités comme en erreur (réseau, lockfile absent) : seul un rapport
  # avec un objet « vulnerabilities » et sans « error » est une mesure.
  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const v = j?.vulnerabilities;
    process.exit(v && typeof v === "object" && !Array.isArray(v) && !("error" in j) ? 0 : 1);' "$SORTIE/npm-audit.json" 2>> "$SORTIE/npm-audit.log"
  code audit_npm $?
fi

# Semgrep sur les fichiers modifiés existants, règles figées, sans réseau ni télémétrie. Code 0 avec ou sans
# résultat (pas de --error) ; --disable-nosem : un commentaire « nosemgrep » du dépôt ne masque rien ;
# les fichiers passés explicitement ignorent .semgrepignore ; « -- » : un nom de fichier n'est jamais une option.
mapfile -t FICHIERS < "$SORTIE/fichiers-modifies"
if [ ${#FICHIERS[@]} -gt 0 ]; then
  timeout 900 semgrep scan --config /opt/analyse/semgrep-regles.yml --json --metrics=off --disable-version-check --disable-nosem \
    --output "$SORTIE/semgrep.json" -- "${FICHIERS[@]}" > "$SORTIE/semgrep.log" 2>&1
  code semgrep $?
else
  echo '{"results":[]}' > "$SORTIE/semgrep.json"; code semgrep 0
fi

# gitleaks sur les commits de la branche uniquement, depuis un clone sans fichiers de travail (ni .gitleaks.toml
# ni .gitleaksignore du dépôt), avec la configuration par défaut imposée, sans « gitleaks:allow », secrets masqués.
# Lancé depuis $HOME, vide : gitleaks lit aussi le .gitleaksignore du dossier courant.
CLONE="$HOME/gitleaks-source"
printf '[extend]\nuseDefault = true\n' > "$HOME/gitleaks.toml"
if git clone -q --no-checkout "$PROJET" "$CLONE" > "$SORTIE/gitleaks.log" 2>&1; then
  ( cd "$HOME" && timeout 600 gitleaks git "$CLONE" --no-banner --no-color --redact --config "$HOME/gitleaks.toml" --ignore-gitleaks-allow \
    --log-opts="$BASE..HEAD" --report-format json --report-path "$SORTIE/gitleaks.json" --exit-code 0 >> "$SORTIE/gitleaks.log" 2>&1 )
  code gitleaks $?
else
  code gitleaks 3
fi
rm -rf "$CLONE"
exit 0
