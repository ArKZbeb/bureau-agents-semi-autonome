FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Certificats racine d'entreprise (proxy TLS) : déposer des *.crt dans conteneur/certificats/
COPY certificats/ /usr/local/share/ca-certificates/bureau/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

RUN npm install -g @anthropic-ai/claude-code@2.1.312 && npm cache clean --force

COPY managed-settings.json /etc/claude-code/managed-settings.json
COPY hook-gardien.mjs /opt/hooks/hook-gardien.mjs
COPY passerelle.mjs /opt/passerelle/passerelle.mjs

RUN mkdir -p /workspace && chown node:node /workspace
ENV CLAUDE_CONFIG_DIR=/workspace/.etat-claude \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_AUTOUPDATER=1 \
    NPM_CONFIG_IGNORE_SCRIPTS=true
USER node
WORKDIR /workspace
