# shared-ui production image (DEVELOPER.md, Production Images): the header's CDN bundle on a stock Caddy static server.
# The edge (apps/portal-web/caddy) fronts it at /shared-ui/ with the WAF and security headers. A header release rebuilds
# only this image. Build from the repository root:
#   podman build -f packages/shared-ui/Dockerfile -t shared-ui .

FROM docker.io/library/node:26.13.1-slim AS base
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
  pnpm install --offline --frozen-lockfile --store-dir /pnpm/store --filter "@repo/shared-ui..."
RUN pnpm --filter "@repo/shared-ui..." run build

# Strip the binary's cap_net_bind_service file capability in a throwaway stage: OpenShift drops every capability,
# and exec of a binary that requests one then fails. Doing it in the final stage would ship the binary twice.
FROM docker.io/library/caddy:2.11.9-alpine AS caddy
RUN setcap -r /usr/bin/caddy && ! getcap /usr/bin/caddy | grep -q .

FROM docker.io/library/alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
# mailcap provides /etc/mime.types (Content-Type for types Go doesn't know). apk is then removed.
RUN apk add --no-cache mailcap && apk --purge del apk-tools
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
# Group 0 and g=u so OpenShift's arbitrary UID (always in group 0) can write Caddy's state dirs.
RUN mkdir -p /config /data && chgrp -R 0 /config /data && chmod -R g=u /config /data
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY packages/shared-ui/Caddyfile /etc/caddy/Caddyfile
# dist/cdn holds header/v<major>/sdg-header.js. COPY keeps the build's mtime, which Caddy's ETag needs (it omits the
# ETag for an mtime of 0 or 1, as reproducible-build tools set).
COPY --from=build /app/packages/shared-ui/dist/cdn /srv
USER 1001
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
