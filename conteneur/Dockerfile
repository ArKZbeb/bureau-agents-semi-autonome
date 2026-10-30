FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Certificats racine d'entreprise (proxy TLS) : déposer des *.crt dans conteneur/certificats/
COPY certificats/ /usr/local/share/ca-certificates/bureau/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

RUN npm install -g @anthropic-ai/claude-code@2.1.312 && npm cache clean --force

# Outils d'analyse lancés par l'orchestrateur (jamais par un agent) : versions exactes, téléchargements vérifiés par SHA-256.
# Chromium vient de bookworm-security, qui retire les anciennes versions : si l'installation échoue, relever la version courante.
ARG CHROMIUM_VERSION=156.0.8078.73-1~deb12u1
RUN apt-get update && apt-get install -y --no-install-recommends chromium=${CHROMIUM_VERSION} python3-venv curl libicu72 && rm -rf /var/lib/apt/lists/*

# .NET : archives versionnées (le script dotnet-install.sh change sans version). SDK 9 et runtimes ASP.NET Core / .NET 8.
ARG DOTNET_SDK_VERSION=9.0.320
ARG DOTNET_SDK_SHA256=83374176f286b61298248b464f09198107ee3f42b6a8f52c6b82f0ca0566156e
ARG ASPNET8_VERSION=8.0.33
ARG ASPNET8_SHA256=1ce73ddba660cd83103eed9f54e73cecfb61f515109e8f264dff8feb82b43693
RUN mkdir -p /usr/share/dotnet \
 && curl -fsSL -o /tmp/sdk.tar.gz "https://builds.dotnet.microsoft.com/dotnet/Sdk/${DOTNET_SDK_VERSION}/dotnet-sdk-${DOTNET_SDK_VERSION}-linux-x64.tar.gz" \
 && echo "${DOTNET_SDK_SHA256}  /tmp/sdk.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/sdk.tar.gz -C /usr/share/dotnet && rm /tmp/sdk.tar.gz \
 && curl -fsSL -o /tmp/aspnet.tar.gz "https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/${ASPNET8_VERSION}/aspnetcore-runtime-${ASPNET8_VERSION}-linux-x64.tar.gz" \
 && echo "${ASPNET8_SHA256}  /tmp/aspnet.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/aspnet.tar.gz -C /usr/share/dotnet ./shared && rm /tmp/aspnet.tar.gz \
 && ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false

# dotnet-coverage : paquet vérifié, installé depuis une source locale seulement.
ARG DOTNET_COVERAGE_VERSION=18.12.0
ARG DOTNET_COVERAGE_SHA256=9801be478cc1da9b4c911563c7549bcf018b12a525dfa56e9edc33cc60ab66ef
RUN mkdir -p /tmp/paquets \
 && curl -fsSL -o "/tmp/paquets/dotnet-coverage.${DOTNET_COVERAGE_VERSION}.nupkg" "https://api.nuget.org/v3-flatcontainer/dotnet-coverage/${DOTNET_COVERAGE_VERSION}/dotnet-coverage.${DOTNET_COVERAGE_VERSION}.nupkg" \
 && echo "${DOTNET_COVERAGE_SHA256}  /tmp/paquets/dotnet-coverage.${DOTNET_COVERAGE_VERSION}.nupkg" | sha256sum -c - \
 && printf '<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear /><add key="local" value="/tmp/paquets" /></packageSources></configuration>\n' > /tmp/nuget.config \
 && DOTNET_CLI_HOME=/tmp/dch NUGET_PACKAGES=/tmp/dch/nuget dotnet tool install --tool-path /opt/dotnet-outils dotnet-coverage --version "${DOTNET_COVERAGE_VERSION}" --configfile /tmp/nuget.config \
 && ln -s /opt/dotnet-outils/dotnet-coverage /usr/local/bin/dotnet-coverage \
 && rm -rf /tmp/paquets /tmp/nuget.config /tmp/dch

# Semgrep et toutes ses dépendances : roues figées par SHA-256.
COPY analyse/semgrep-requirements.txt /opt/analyse/semgrep-requirements.txt
RUN python3 -m venv /opt/semgrep \
 && /opt/semgrep/bin/pip install --no-cache-dir --disable-pip-version-check --require-hashes --no-deps --only-binary :all: -r /opt/analyse/semgrep-requirements.txt \
 && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep
# Ni vérification de version ni télémétrie : sans elles, hors réseau, chaque appel attend son délai réseau.
ENV SEMGREP_ENABLE_VERSION_CHECK=0 SEMGREP_SEND_METRICS=off

ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
RUN curl -fsSL -o /tmp/gitleaks.tar.gz "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
 && echo "${GITLEAKS_SHA256}  /tmp/gitleaks.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks && rm /tmp/gitleaks.tar.gz
# Configuration gitleaks : celle de la version, vérifiée, privée de sa liste blanche globale de chemins (fichiers
# gitleaks.toml, verrous npm, vendor/, images…), qu'un dépôt pourrait utiliser pour cacher un secret.
ARG GITLEAKS_CONFIG_SHA256=e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf
RUN mkdir -p /opt/analyse \
 && curl -fsSL -o /tmp/gitleaks-defaut.toml "https://raw.githubusercontent.com/gitleaks/gitleaks/v${GITLEAKS_VERSION}/config/gitleaks.toml" \
 && echo "${GITLEAKS_CONFIG_SHA256}  /tmp/gitleaks-defaut.toml" | sha256sum -c - \
 && awk '/^\[allowlist\]$/ { globale = 1 } /^\[\[rules\]\]$/ { globale = 0 } \
         globale && /^paths = \[$/ { saute = 1; next } saute { if ($0 ~ /^\]$/) saute = 0; next } { print }' \
      /tmp/gitleaks-defaut.toml > /opt/analyse/gitleaks.toml \
 && [ "$(grep -c '^\[\[rules\]\]$' /opt/analyse/gitleaks.toml)" = "$(grep -c '^\[\[rules\]\]$' /tmp/gitleaks-defaut.toml)" ] \
 && ! sed -n '/^\[allowlist\]$/,/^\[\[rules\]\]$/p' /opt/analyse/gitleaks.toml | grep -q '^paths' \
 && mkdir /tmp/vide && gitleaks dir /tmp/vide --no-banner --config /opt/analyse/gitleaks.toml --exit-code 1 \
 && rm -rf /tmp/vide /tmp/gitleaks-defaut.toml

# Règles Semgrep (licence non libre, jamais versionnées) : p/csharp et p/typescript récupérées à la construction,
# vérifiées puis réunies. Le digest de l'image, dans le manifeste signé, fige les règles utilisées.
RUN set -e; for p in csharp typescript; do \
      curl -fsSL -o "/tmp/$p.yml" "https://semgrep.dev/c/p/$p"; \
      [ "$(head -n 1 "/tmp/$p.yml")" = "rules:" ] || { echo "p/$p : réponse inattendue" >&2; exit 1; }; \
      n=$(grep -c '^- id: ' "/tmp/$p.yml") || { echo "p/$p : aucune règle" >&2; exit 1; }; \
      echo "p/$p : $n règles, sha256 $(sha256sum "/tmp/$p.yml" | cut -d ' ' -f 1)"; \
    done; \
    { echo "# Règles Semgrep p/csharp et p/typescript (semgrep.dev, Semgrep Rules License v1.0), récupérées à la construction de l'image."; \
      echo 'rules:'; tail -n +2 /tmp/csharp.yml; tail -n +2 /tmp/typescript.yml; } > /opt/analyse/semgrep-regles.yml; \
    rm /tmp/csharp.yml /tmp/typescript.yml; \
    echo 'class Vide {}' > /tmp/vide.cs; \
    HOME=/tmp/sg semgrep scan --config /opt/analyse/semgrep-regles.yml --metrics=off --disable-version-check --json --quiet --output /tmp/sg.json /tmp/vide.cs \
      || { echo "règles Semgrep invalides" >&2; exit 1; }; \
    rm -rf /tmp/sg /tmp/sg.json /tmp/vide.cs

# Fichiers nommés un à un : une copie locale non versionnée des règles n'entre jamais dans l'image.
COPY analyse/mesurer.sh analyse/tester.sh analyse/chromium-conteneur analyse/karma.conf.cjs /opt/analyse/
RUN chmod 0555 /opt/analyse/mesurer.sh /opt/analyse/tester.sh /opt/analyse/chromium-conteneur \
 && chmod 0444 /opt/analyse/karma.conf.cjs /opt/analyse/semgrep-regles.yml /opt/analyse/semgrep-requirements.txt /opt/analyse/gitleaks.toml

COPY managed-settings.json /etc/claude-code/managed-settings.json
COPY hook-gardien.mjs /opt/hooks/hook-gardien.mjs
COPY passerelle.mjs /opt/passerelle/passerelle.mjs

# /mesures : point de montage du volume des mesures (mesurer.sh), propre à l'orchestrateur.
RUN mkdir -p /workspace /mesures && chown node:node /workspace /mesures
ENV CLAUDE_CONFIG_DIR=/workspace/.etat-claude \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_AUTOUPDATER=1 \
    NPM_CONFIG_IGNORE_SCRIPTS=true \
    npm_config_cache=/tmp/.npm
USER node
WORKDIR /workspace
