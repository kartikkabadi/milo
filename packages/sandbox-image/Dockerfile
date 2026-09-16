# Milo sandbox image.
#
# One container, three harnesses, no secrets.
#
# Design notes that matter:
#
#   - Node 22+, because Command Code refuses to start on Node 20 or below.
#   - `--ignore-scripts` on the Pi install. Pi does not need lifecycle scripts,
#     and skipping them removes a supply-chain surface from an image that will
#     run model-generated code.
#   - Themes are NOT baked in. The Worker writes them at launch from
#     themes/bundle.json, so a deployed Worker and the harness config it
#     references can never disagree. A theme baked into an image is a theme
#     that silently goes stale.
#   - No credentials, ever. GitHub and model keys live in the Worker and are
#     injected by the outbound handler. A `docker history` on this image
#     reveals nothing sensitive, and neither does a shell inside it.
#   - node_modules is deliberately absent from the snapshot path, so `npm ci`
#     has to be fast: the npm cache is warmed for the common toolchain.

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=development \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      curl \
      jq \
      ripgrep \
      fd-find \
      tar \
      gzip \
      xz-utils \
      squashfs-tools \
      build-essential \
      python3 \
      python3-pip \
      python3-venv \
      less \
      procps \
      openssh-client \
    && rm -rf /var/lib/apt/lists/*

# pnpm and bun, because harnesses and user repos reach for them.
RUN npm install -g pnpm@latest --ignore-scripts \
 && curl -fsSL https://bun.sh/install | bash \
 && mv /root/.bun/bin/bun /usr/local/bin/bun

# The three harnesses. Three separate tools, three separate installs, no
# wrapper pretending they are one thing.
#
#   Pi           --mode json for the event stream; themes from themes/pi/*.json
#   OpenCode     -- plan/explore/scout are read-only, build needs a filesystem
#   Command Code -- -p is read-only by default; --yolo is gated behind Tier 3
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
 && npm install -g opencode-ai \
 && npm install -g command-code@latest \
 && pi --version \
 && opencode --version \
 && cmd --version

# Warm the npm cache with the packages every agent reaches for first. This is
# the cheapest possible fix for the most expensive repeated cost: `npm ci` on
# every wake after a snapshot restore.
RUN mkdir -p /tmp/warm && cd /tmp/warm \
 && npm init -y >/dev/null \
 && npm install --ignore-scripts --no-audit --no-fund \
      typescript tsx vitest @types/node \
      eslint prettier \
      react react-dom vite \
      wrangler \
 && rm -rf /tmp/warm/node_modules /tmp/warm/package.json /tmp/warm/package-lock.json

# An unprivileged user. The container runs model-generated code; it should not
# be doing it as root.
RUN useradd --create-home --shell /bin/bash --uid 1000 sandbox \
 && mkdir -p /workspace /data /home/sandbox/.milo/themes \
 && chown -R sandbox:sandbox /workspace /data /home/sandbox \
 && chmod -R a+rX /home/sandbox

# Backups must be able to read every file. Files at 0600 are the single most
# common cause of a failed snapshot, and harnesses create them constantly.
RUN printf '#!/bin/sh\nchmod -R a+rX "$1" 2>/dev/null || true\n' > /usr/local/bin/milo-relax \
 && chmod +x /usr/local/bin/milo-relax

USER sandbox
WORKDIR /workspace

ENV HOME=/home/sandbox \
    SHELL=/bin/bash \
    TERM=xterm-256color \
    COLORTERM=truecolor \
    PATH="/home/sandbox/.local/bin:/usr/local/bin:/usr/bin:/bin"

# The SDK needs a long-lived process to hold. Sandbox SDK handles the entrypoint;
# this is what it supervises.
CMD ["sleep", "infinity"]
