#!/usr/bin/env bash
set -euo pipefail
umask 077

# Override only for isolated rehearsal; production cron uses /opt/opengym.
DEPLOY_DIR="${OPENGYM_DEPLOY_DIR:-/opt/opengym}"
DATA_DIR="$DEPLOY_DIR/data"
BACKUP_DIR="$DEPLOY_DIR/backups"
REMOTE_DIR="${OPENGYM_BACKUP_REMOTE:?Set OPENGYM_BACKUP_REMOTE to your own rclone destination}"
RETENTION_DAYS=14
REMOTE_RETENTION_DAYS=90
COMPOSE=(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.server.yml")

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

[[ -d "$DATA_DIR" ]] || die "data directory is missing"
for dependency in age rclone docker flock timeout; do
  command -v "$dependency" >/dev/null 2>&1 || die "$dependency is unavailable"
done
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || die "another backup is running"

# Only a public encryption recipient is stored here; keep the private key elsewhere.
recipient="$(cat "$DEPLOY_DIR/backup-recipient.txt")"
[[ "$recipient" =~ ^age1[0-9a-z]+$ ]] || die "a valid age recipient is not configured"
api_id="$("${COMPOSE[@]}" ps --all -q api)"
[[ -n "$api_id" ]] || die "API container is missing"
running="$(docker inspect --format '{{.State.Running}}' "$api_id")"
[[ "$running" == true || "$running" == false ]] || die "cannot determine API state"

stamp="$(date +%Y%m%d_%H%M%S)"
archive="$BACKUP_DIR/opengym_${stamp}.tar.gz.age"
temporary="$(mktemp "$BACKUP_DIR/.opengym_${stamp}.XXXXXX")"
restart_needed=0
complete=0

resume_api() {
  if (( restart_needed )); then
    docker start "$api_id" >/dev/null || return 1
    restart_needed=0
    log "API restarted after consistent backup."
  fi
}
cleanup() {
  local result=$?
  trap - EXIT
  if ! resume_api; then
    log "ERROR: API restart failed; operator action required."
    result=1
  fi
  [[ -z "$temporary" ]] || rm -f -- "$temporary"
  if (( result != 0 || ! complete )); then
    log "ERROR: backup did not complete; no retention cleanup after failed upload."
    printf '{"ok":false,"time":"%s"}\n' "$(date -u +%FT%TZ)" >"$BACKUP_DIR/status.json.tmp"
  else
    printf '{"ok":true,"time":"%s","archive":"%s"}\n' "$(date -u +%FT%TZ)" "${archive##*/}" >"$BACKUP_DIR/status.json.tmp"
  fi
  mv -f "$BACKUP_DIR/status.json.tmp" "$BACKUP_DIR/status.json"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Stop the sole writer, then encrypt a point-in-time directory. Always restart on
# error or interruption; upload happens only after API is available again.
if [[ "$running" == true ]]; then
  restart_needed=1
  docker stop --time 30 "$api_id" >/dev/null
fi
log "Writing encrypted consistent backup."
timeout 10m bash -o pipefail -c \
  'tar czf - -C "$1" data | age --encrypt --recipient "$2" --output "$3"' \
  backup "$DEPLOY_DIR" "$recipient" "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$archive"
temporary=""
resume_api

# A stalled remote must not leave the daily job (and lock) alive forever.
timeout 20m rclone copyto --retries 3 -- "$archive" "$REMOTE_DIR/${archive##*/}"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'opengym_*.tar.gz.age' -mtime "+$RETENTION_DAYS" -delete
timeout 5m rclone delete --min-age "${REMOTE_RETENTION_DAYS}d" --include 'opengym_*.tar.gz.age' "$REMOTE_DIR"
complete=1
log "Encrypted backup uploaded; local retention ${RETENTION_DAYS} days, remote retention ${REMOTE_RETENTION_DAYS} days."
