# Private deployment overlay on the verified 1.4.1 app files, rebuilt on the
# security-patched Node runtime. Build from repository root after installing the
# plugin dependencies as documented in docs/OPERATIONS.md.
FROM ghcr.io/duartesantos8/opengym-api:1.4.1 AS upstream

FROM node:22.23.4-alpine
RUN apk upgrade --no-cache \
 && adduser -D -H -s /sbin/nologin coach \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app
COPY --from=upstream /app /app
COPY api/server.js /app/server.js
COPY api/heart-rate.js api/heart-rate-data.js api/heart-rate-time.js api/heart-rate-metrics.js api/health-upload-credentials.js api/daily-health.js api/daily-health-data.js api/sync-stamps.js api/nutrition-state.js api/watch-credentials.js api/watch-pairing.js /app/
COPY api/vendor /app/vendor
COPY api/plugin /app/plugin
COPY api/test/helpers.mjs /app/test/helpers.mjs
COPY frontend/package.json /frontend/package.json
COPY frontend/src/lib /frontend/src/lib
COPY frontend/src/locales/zh.js /frontend/src/locales/zh.js
COPY frontend/src/instr/en.js /frontend/src/instr/en.js
COPY frontend/src/instr/zh.js /frontend/src/instr/zh.js
COPY catalogue/i18n/zh.json /catalogue/i18n/zh.json

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
HEALTHCHECK --interval=5m --timeout=5s --retries=3 \
  CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
