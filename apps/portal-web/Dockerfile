# portal-web production image (DEVELOPER.md, Production Images): the built SPA on a stock Caddy static server.
# The edge image (caddy/Dockerfile) fronts it with the WAF, security headers and the /api proxy. Build from the
# repository root:
#   podman build -f apps/portal-web/Dockerfile -t portal-web .

FROM docker.io/library/node:24.22.1-slim AS base
ENV CI=true LEFTHOOK=0
# Same pnpm as the host: the version comes from devEngines in package.json.
COPY package.json /tmp/package.json
RUN npm install --global "pnpm@$(node -p "require('/tmp/package.json').devEngines.packageManager.version")" \
  && rm /tmp/package.json
WORKDIR /app

FROM base AS build
# Fetch from the lockfile alone, so this layer is reused until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --offline --frozen-lockfile --store-dir /pnpm/store --filter "portal-web..."
# pnpm builds the workspace packages portal-web imports (design-system, sdg-header) first, in topological order.
RUN pnpm --filter "portal-web..." run build

# Strip the binary's cap_net_bind_service file capability in a throwaway stage: OpenShift drops every capability,
# and exec of a binary that requests one then fails. Doing it in the final stage would ship the binary twice.
FROM docker.io/library/caddy:2.11.7-alpine AS caddy
RUN setcap -r /usr/bin/caddy && ! getcap /usr/bin/caddy | grep -q .

FROM docker.io/library/alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
# mailcap provides /etc/mime.types (Content-Type for fonts and other types Go doesn't know). apk is then removed.
RUN apk add --no-cache mailcap && apk --purge del apk-tools
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
# Group 0 and g=u so OpenShift's arbitrary UID (always in group 0) can write Caddy's state dirs.
RUN mkdir -p /config /data && chgrp -R 0 /config /data && chmod -R g=u /config /data
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY apps/portal-web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/portal-web/dist /srv
USER 1001
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
