#!/bin/sh

CONFIG="/data/mdns.json"

log() { echo "[mdns-supervisor] $*"; }

PIDS=""
DOMAINS_PIDS=""

stop_all() {
  for entry in $DOMAINS_PIDS; do
    pid="${entry##*:}"
    kill "$pid" 2>/dev/null
  done
  PIDS=""
  DOMAINS_PIDS=""
}

cleanup() {
  log "Shutting down"
  stop_all
  exit 0
}

trap cleanup SIGTERM SIGINT

last_md5="" 

get_md5() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  else
    cat "$1" 2>/dev/null
  fi
}

sync_config() {
  stop_all

  if [ ! -f "$CONFIG" ]; then
    log "No config file"
    return 1
  fi

  content=$(cat "$CONFIG" 2>/dev/null)
  if [ -z "$content" ]; then
    log "Empty config"
    return 1
  fi

  count=$(printf '%s' "$content" | grep -o '"domain"' | wc -l)
  if [ "$count" -eq 0 ]; then
    log "No domains in config"
    return 1
  fi

  i=0
  while [ "$i" -lt "$count" ]; do
    domain=$(printf '%s' "$content" | sed -n 's/.*"domain"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n "$((i+1))p")
    ip=$(printf '%s' "$content" | sed -n 's/.*"ip"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n "$((i+1))p")

    if [ -n "$domain" ] && [ -n "$ip" ]; then
      log "Publishing $domain -> $ip"
      DBUS_SYSTEM_BUS_ADDRESS="unix:path=/var/run/dbus/system_bus_socket" \
        avahi-publish -a -R "$domain" "$ip" &
      DOMAINS_PIDS="$DOMAINS_PIDS $domain:$!"
    fi
    i=$((i + 1))
  done

  return 0
}

log "Starting"
sync_config
last_md5=$(get_md5 "$CONFIG")

while true; do
  sleep 3
  current_md5=$(get_md5 "$CONFIG")
  if [ "$current_md5" != "$last_md5" ]; then
    log "Config changed, reloading"
    sync_config
    last_md5="$current_md5"
  fi
done