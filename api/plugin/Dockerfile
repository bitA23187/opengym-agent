# Build the selective 1.4.4 fork and both locked dependency trees from this source.
# No runtime modules are inherited from an older upstream image.
FROM node:22.23.4-alpine AS dependencies
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force
WORKDIR /app/plugin
COPY api/plugin/package.json api/plugin/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.23.4-alpine
RUN apk upgrade --no-cache \
 && adduser -D -H -s /sbin/nologin coach \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY api/ /app/
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/plugin/node_modules /app/plugin/node_modules
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
HEALTHCHECK --interval=30s --start-period=10s --timeout=5s --retries=3 \
  CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
