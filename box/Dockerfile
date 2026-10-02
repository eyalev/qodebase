# forq's agent box image: Claude Code in tmux, mobile-agent (the phone
# terminal, :7901), box-api (chat and status, :7681), git, Node, Python and
# headless Chromium (the reviewer agent screenshots previews with it).
# The contract forq relies on is in SELF_HOST.md ("The box image").
#
#   docker build -t forq-box box/
#   point containers[].images in wrangler.jsonc at it (wrangler pushes it)
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git jq python3 tmux ncurses-term procps \
      chromium fonts-liberation fonts-noto-color-emoji \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Chromium in a container: no user namespaces (--no-sandbox) and a small
# /dev/shm (--disable-dev-shm-usage). Tools that look for google-chrome find it.
RUN printf '#!/bin/sh\nexec /usr/lib/chromium/chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-crash-reporter "$@"\n' > /usr/bin/chromium \
 && chmod +x /usr/bin/chromium && cp /usr/bin/chromium /usr/local/bin/google-chrome \
 && /usr/bin/chromium --version
ENV CHROME_PATH=/usr/bin/chromium PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Claude Code (native install).
RUN curl -fsSL https://claude.ai/install.sh | bash \
 && ln -sf /root/.local/bin/claude /usr/local/bin/claude && claude --version

# mobile-agent, pinned. forq can also unpack a newer copy over it at boot
# (box/mobile-agent.tgz, scripts/pack-mobile-agent.sh).
ARG MOBILE_AGENT_REF=main
RUN git clone https://github.com/eyalev/mobile-agent.git /opt/mobile-agent \
 && cd /opt/mobile-agent && git checkout "$MOBILE_AGENT_REF" && rm -rf .git \
 && npm ci --omit=dev --no-audit --no-fund \
 && node -e "require('/opt/mobile-agent/packages/core/package.json')"

COPY boot.sh /opt/boot.sh
COPY box-api.mjs /opt/box-api.mjs
RUN chmod +x /opt/boot.sh

EXPOSE 7901 7681
# forq starts the box with its own entrypoint (sleep infinity) and runs
# /opt/boot.sh over exec; this default is for trying the image locally.
CMD ["sleep", "infinity"]
