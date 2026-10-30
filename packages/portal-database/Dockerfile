# portal-database migrator image (DEVELOPER.md, Production Images), run as portal-api's initContainer.
# Build from the repository root:
#   podman build -f packages/portal-database/Dockerfile -t portal-database .
# Needs DATABASE_URL. Exits 0 once every committed migration is applied, 1 otherwise.

FROM docker.io/library/node:26.12.0-slim AS base
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
  pnpm install --offline --frozen-lockfile --store-dir /pnpm/store --filter "@repo/portal-database..."
RUN pnpm --filter "@repo/portal-database..." run build
# Self-contained /out: dist, migrations (the package's files) and production node_modules (pg, drizzle-orm).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm deploy --filter @repo/portal-database --prod --store-dir /pnpm/store /out

FROM docker.io/library/alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
# Alpine's nodejs links the system ICU/OpenSSL: about half the size of an image with the official Node binary.
# apk is removed so the final image can't install anything; OpenShift replaces the UID with an arbitrary one.
RUN apk add --no-cache "nodejs~24" && apk --purge del apk-tools
USER 1001
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
CMD ["node", "dist/migrate.js"]
