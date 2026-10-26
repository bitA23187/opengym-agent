# Standalone source build: includes the extension API and its optional MCP service.
FROM node:22-alpine AS dependencies
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts
WORKDIR /app/plugin
COPY api/plugin/package.json api/plugin/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine
RUN apk upgrade --no-cache \
 && adduser -D -H -s /sbin/nologin coach \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY api/*.js ./
COPY api/coach ./coach
COPY api/vendor ./vendor
COPY api/plugin ./plugin
COPY --from=dependencies /app/plugin/node_modules ./plugin/node_modules
# Shared training logic is intentionally imported from the frontend source tree.
COPY frontend/package.json /frontend/package.json
COPY frontend/src/lib /frontend/src/lib
COPY frontend/src/locales/zh.js /frontend/src/locales/zh.js
COPY frontend/src/instr/en.js frontend/src/instr/zh.js /frontend/src/instr/
COPY catalogue/i18n/zh.json /catalogue/i18n/zh.json
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data COACH_DISABLED=1
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
 CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server.js"]
