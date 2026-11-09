# Banana as a container: the built application, served by an unprivileged nginx that also acts as a
# same-origin reverse proxy to one Fusion instance. See docs/adr/0003-standalone-hosting-same-origin-proxy.md
# for what it does and what it does not do, and docs/adr/0023-docker-image.md for how it is built.
#
#   docker build -t banana-hosting .
#
# The base images are pinned by digest. To move to a newer one, change the tag and the digest together.

# The build stage runs on the builder's own platform: the output (dist/) is the same for every
# platform, so it is built once and not under emulation.
FROM --platform=$BUILDPLATFORM node:22.23.4-alpine3.24@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The build no longer produces a WEB-INF directory (a servlet descriptor for Java hosting, which a static web server
# does not need). The removal below is kept only as a guard.
RUN npm run build \
 && rm -rf dist/WEB-INF \
 && mkdir /out \
 && node docker/extract-settings.js /out/settings.json

FROM nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
LABEL org.opencontainers.image.title="Banana" \
      org.opencontainers.image.description="Banana dashboards, served with a same-origin proxy to Lucidworks Fusion" \
      org.opencontainers.image.source="https://github.com/lucidworks/banana" \
      org.opencontainers.image.licenses="Apache-2.0"
USER root
# jq reads the settings and Fusion's answer to the start-up check; fcgiwrap runs the optional
# /healthz/upstream check. Both come from the Alpine release of the base image.
RUN apk add --no-cache jq fcgiwrap \
 && mkdir -p /usr/local/lib/banana /usr/share/banana /run/banana \
 && chown 101:0 /run/banana \
 && chmod 0770 /run/banana \
 && chown -R root:root /etc/nginx /var/cache/nginx
COPY --from=build /src/dist /usr/share/banana/www
COPY --from=build /out/settings.json /usr/local/lib/banana/settings.json
COPY docker/common.sh docker/probe.sh docker/healthz-upstream.cgi docker/render-config.sh docker/render-config.jq \
     docker/nginx.conf docker/checks.conf docker/methods.conf docker/not-found.conf /usr/local/lib/banana/
COPY docker/banana-entrypoint /usr/local/bin/banana-entrypoint
RUN chmod 0755 /usr/local/bin/banana-entrypoint /usr/local/lib/banana/probe.sh /usr/local/lib/banana/healthz-upstream.cgi /usr/local/lib/banana/render-config.sh
USER 101
EXPOSE 8080
# /healthz answers from the container itself and never calls Fusion.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/banana-entrypoint"]
