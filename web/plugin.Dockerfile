# Preserve the verified upstream nginx runtime and exercise media; replace only
# the architecture-independent frontend built and tested on the operator machine.
FROM ghcr.io/duartesantos8/opengym-web:1.4.4
COPY frontend/dist/ /usr/share/nginx/html/

HEALTHCHECK --interval=30s --start-period=10s --timeout=5s --retries=3 CMD wget --spider -q "http://127.0.0.1:${NGINX_PORT}/" || exit 1
