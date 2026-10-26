# Edge: Caddy with the Coraza WAF in front of portal-web and portal-api. Runs Caddyfile (production) by default;
# compose.yaml mounts and runs Caddyfile.dev.
FROM docker.io/library/caddy:2.11.7-builder-alpine AS builder
# The builder image sets XCADDY_SETCAP=1, which grants the binary cap_net_bind_service. OpenShift drops every
# capability, and exec of a binary that requests one then fails; the production ports (3000, 3003) need none.
RUN XCADDY_SETCAP=0 xcaddy build --with github.com/corazawaf/coraza-caddy/v2@v2.6.2 \
  && ! getcap /usr/bin/caddy | grep -q .

# Plain Alpine rather than the caddy image, whose own binary would ship alongside the Coraza build.
FROM docker.io/library/alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
# mailcap provides /etc/mime.types (Content-Type for types Go doesn't know). apk is then removed.
RUN apk add --no-cache mailcap && apk --purge del apk-tools
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Group 0 and g=u so OpenShift's arbitrary UID (always in group 0) can write Caddy's state (/config autosave,
# /data storage) and the Coraza temp/data dirs.
RUN mkdir -p /config /data /tmp/coraza && chgrp -R 0 /config /data /tmp/coraza \
  && chmod -R g=u /config /data /tmp/coraza
COPY coraza.conf common.caddy Caddyfile /etc/caddy/
# Non-root like the other images; OpenShift replaces the UID with an arbitrary one in group 0.
USER 1001
EXPOSE 3000 3003
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
