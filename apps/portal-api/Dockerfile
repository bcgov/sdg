# portal-api production image (DEVELOPER.md, Production Images). Build from the repository root:
#   podman build -f apps/portal-api/Dockerfile -t portal-api .
# Runs on Alpine Node as any UID: the app only reads /app. Secrets come from the environment at runtime.

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
  pnpm install --offline --frozen-lockfile --store-dir /pnpm/store --filter "portal-api..."
# pnpm builds the workspace packages portal-api imports (auth, portal-database) first, in topological order.
RUN pnpm --filter "portal-api..." run build
# Self-contained /out: dist, production node_modules, and the workspace packages' published files.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm deploy --filter portal-api --prod --store-dir /pnpm/store /out

FROM docker.io/library/alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
# Alpine's nodejs links the system ICU/OpenSSL: about half the size of an image with the official Node binary.
# apk is removed so the final image can't install anything; OpenShift replaces the UID with an arbitrary one.
RUN apk add --no-cache "nodejs~24" && apk --purge del apk-tools
USER 1001
# NODE_ENV defaults to development in the env schema, which loads pino-pretty (a devDependency) and Swagger.
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /out .
EXPOSE 3000
CMD ["node", "dist/main.js"]
