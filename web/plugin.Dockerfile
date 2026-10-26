# Preserve the verified upstream nginx runtime and exercise media; replace only
# the architecture-independent frontend built and tested on the operator machine.
FROM ghcr.io/duartesantos8/opengym-web:1.4.1
COPY frontend/dist/ /usr/share/nginx/html/
