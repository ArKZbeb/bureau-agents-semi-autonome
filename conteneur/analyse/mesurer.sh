#!/bin/bash
# Mesures sur la copie de contrôle, lancées par l'orchestrateur AVANT tester.sh. Usage : mesurer.sh COMMIT_BASE
# Aucun code du dépôt n'est exécuté : dépôt monté en lecture seule, HOME et caches sous /tmp, résultats dans /mesures,
# un volume que le conteneur de tests ne voit jamais. Chaque outil écrit OUTIL.code (code de retour) ou OUTIL.na.
# Le dépôt est de la donnée : aucune de ses configurations ne peut masquer un constat (Semgrep, gitleaks, diff, npm).
set -u
BASE="${1:-}"
SORTIE=/mesures
PROJET=/workspace/projet
export HOME=/tmp/mesures-home npm_config_cache=/tmp/mesures-home/npm npm_config_ignore_scripts=true npm_config_update_notifier=false
# Variables d'environnement : elles priment sur le .npmrc du dépôt (registre détourné, dépendances omises).
export npm_config_registry=https://registry.npmjs.org/ npm_config_include=dev,optional,peer
export SEMGREP_ENABLE_VERSION_CHECK=0 SEMGREP_SEND_METRICS=off
# Les objets de remplacement (refs/replace) ne réécrivent pas l'historique lu par git.
export GIT_NO_REPLACE_OBJECTS=1
# Résultats précédents effacés d'abord : un arrêt prématuré ne laisse aucune mesure périmée.
[ -d "$SORTIE" ] && find "$SORTIE" -mindepth 1 -delete || exit 3
rm -rf "$HOME" && mkdir -p "$HOME" || exit 3
cd "$PROJET" || exit 3
git config --global safe.directory '*'
# Base vérifiée avant tout : avec une base absente, gitleaks renvoie 0 et « [] » (faux négatif).
case "$BASE" in *[!0-9a-f]*|'') echo "commit de base invalide" >&2; exit 3;; esac
git cat-file -e "$BASE^{commit}" 2>/dev/null || { echo "commit de base absent" >&2; exit 3; }

git rev-parse HEAD > "$SORTIE/sha" || exit 3
# --text et sans pilote : un attribut « -diff » ou « binary » du dépôt ne cache pas de lignes modifiées.
git diff -U0 --text --no-ext-diff --no-textconv "$BASE..HEAD" > "$SORTIE/diff.patch" || exit 3
# Chemins séparés par NUL : aucun nom de fichier n'est re-cité ni coupé.
git diff --name-only -z --diff-filter=d "$BASE..HEAD" > "$SORTIE/fichiers-modifies" || exit 3

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

# Applicabilité des stacks de tests, décidée ici sur le dépôt intact (mêmes règles que tester.sh) : tester.sh exécute
# le code du dépôt, qui pourrait écrire un .na ; l'orchestrateur ne retient ce .na que si la stack est absente ici aussi.
cible_unique -name '*.sln' -o -name '*.slnx'; ETAT=$?
[ $ETAT -eq 1 ] && { cible_unique -name '*.csproj'; ETAT=$?; }
[ $ETAT -eq 1 ] && : > "$SORTIE/stack_dotnet.na"
cible_unique -name angular.json; [ $? -eq 1 ] && : > "$SORTIE/stack_angular.na"

# npm audit du projet Angular : package.json et package-lock.json seuls, copiés dans un dossier vide (aucun .npmrc
# ni autre fichier du dépôt : package-lock=false ou workspace= changeraient l'arbre audité), sans npm ci ni script.
cible_unique -name angular.json
case $? in
  1) na audit_npm ;;
  2) echo "plusieurs angular.json à la même profondeur" > "$SORTIE/npm-audit.log"; code audit_npm 3 ;;
  *)
    DOSSIER=$(dirname "$CIBLE") AUDIT="$HOME/npm-audit"
    mkdir -p "$AUDIT"
    for f in package.json package-lock.json; do
      # Fichiers ordinaires seulement : un lien pourrait désigner n'importe quoi.
      [ -f "$DOSSIER/$f" ] && [ ! -L "$DOSSIER/$f" ] && cp -- "$DOSSIER/$f" "$AUDIT/$f"
    done
    ( cd "$AUDIT" && timeout 600 npm audit --json > "$SORTIE/npm-audit.json" 2> "$SORTIE/npm-audit.log" )
    # npm audit renvoie 1 avec des vulnérabilités comme en erreur (réseau, lockfile absent) : seul un rapport
    # avec un objet « vulnerabilities » et sans « error » est une mesure.
    node -e '
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const v = j?.vulnerabilities;
      process.exit(v && typeof v === "object" && !Array.isArray(v) && !("error" in j) ? 0 : 1);' "$SORTIE/npm-audit.json" 2>> "$SORTIE/npm-audit.log"
    code audit_npm $? ;;
esac

# Semgrep sur les fichiers modifiés existants, règles figées, sans réseau ni télémétrie. Code 0 avec ou sans
# résultat (pas de --error) ; --disable-nosem : un commentaire « nosemgrep » du dépôt ne masque rien ;
# --max-target-bytes 0 : aucun fichier écarté pour sa taille ; les fichiers passés explicitement ignorent
# .semgrepignore ; « -- » : un nom de fichier n'est jamais une option.
mapfile -d '' -t FICHIERS < "$SORTIE/fichiers-modifies"
if [ ${#FICHIERS[@]} -gt 0 ]; then
  timeout 900 semgrep scan --config /opt/analyse/semgrep-regles.yml --json --metrics=off --disable-version-check --disable-nosem \
    --max-target-bytes 0 --output "$SORTIE/semgrep.json" -- "${FICHIERS[@]}" > "$SORTIE/semgrep.log" 2>&1
  code semgrep $?
else
  echo '{"results":[]}' > "$SORTIE/semgrep.json"; code semgrep 0
fi

# gitleaks sur les commits de la branche uniquement, depuis un clone sans fichiers de travail (ni .gitleaks.toml
# ni .gitleaksignore du dépôt), avec la configuration de l'image (règles par défaut sans la liste blanche globale
# de chemins), sans « gitleaks:allow », secrets masqués. Lancé depuis $HOME, vide : gitleaks lit aussi le
# .gitleaksignore du dossier courant.
CLONE="$HOME/gitleaks-source"
if git clone -q --no-checkout --no-hardlinks "$PROJET" "$CLONE" > "$SORTIE/gitleaks.log" 2>&1; then
  ( cd "$HOME" && timeout 600 gitleaks git "$CLONE" --no-banner --no-color --redact --config /opt/analyse/gitleaks.toml --ignore-gitleaks-allow \
    --log-opts="$BASE..HEAD" --report-format json --report-path "$SORTIE/gitleaks.json" --exit-code 0 >> "$SORTIE/gitleaks.log" 2>&1 )
  code gitleaks $?
else
  code gitleaks 3
fi
rm -rf "$CLONE"
exit 0
