FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY api/coach/core /app/api/coach/core
COPY frontend/ ./
ARG APP_BUILD=agent-v1.4.4
RUN APP_BUILD="$APP_BUILD" npm run build

# The upstream image supplies licensed exercise media in-place for openGym use.
# Do not extract the media or commit it to this source repository.
FROM ghcr.io/duartesantos8/opengym-web:1.4.4
COPY --from=build /app/frontend/dist/ /usr/share/nginx/html/
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
