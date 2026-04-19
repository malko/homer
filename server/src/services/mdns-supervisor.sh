#!/bin/sh

CONFIG="/data/mdns.json"
DBUS_ADDR="unix:path=/var/run/dbus/system_bus_socket"

log() { echo "[mdns-supervisor] $*"; }

stop_all() {
  pkill -TERM -f '^avahi-publish' 2>/dev/null
  sleep 1
}

cleanup() {
  log "Shutting down"
  stop_all
  [ -n "$RESOLVER_PID" ] && kill "$RESOLVER_PID" 2>/dev/null
  exit 0
}

trap cleanup SIGTERM SIGINT

last_hash=""

get_hash() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  else
    wc -c < "$1" 2>/dev/null
  fi
}

publish_domains() {
  # Use Node.js to parse JSON reliably (sed/awk can't handle multi-line JSON)
  node -e "
    const fs = require('fs');
    const { spawn } = require('child_process');
    const config = JSON.parse(fs.readFileSync('${CONFIG}', 'utf8'));
    (config.domains || []).forEach(d => {
      if (d.domain && d.ip) {
        console.log('[mdns-supervisor] Publishing A ' + d.domain + ' -> ' + d.ip);
        spawn('avahi-publish', ['-a', '-R', d.domain, d.ip], { detached: true, stdio: 'ignore' }).unref();
      }
    });
  "
}

publish_services() {
  # Use Node.js to parse JSON reliably
  node -e "
    const fs = require('fs');
    const { spawn } = require('child_process');
    const config = JSON.parse(fs.readFileSync('${CONFIG}', 'utf8'));
    (config.services || []).forEach(s => {
      if (s.type && s.name && s.port) {
        console.log('[mdns-supervisor] Publishing service ' + s.name + ' (' + s.type + ' port ' + s.port + ')');
        spawn('avahi-publish', ['-s', s.name, s.type, String(s.port), ...(s.txt || [])], { detached: true, stdio: 'ignore' }).unref();
      }
    });
  "
}

sync_config() {
  stop_all
  if [ ! -f "$CONFIG" ]; then
    log "No config file yet"
    return 1
  fi
  publish_domains
  publish_services
  return 0
}

resolver_loop() {
  while true; do
    for reqfile in /data/mdns-resolve-*.request; do
      [ -f "$reqfile" ] || continue
      hostname=$(cat "$reqfile" 2>/dev/null)
      id="${reqfile#/data/mdns-resolve-}"
      id="${id%.request}"
      rm -f "$reqfile"
      [ -z "$hostname" ] && continue
      ip=$(DBUS_SYSTEM_BUS_ADDRESS="$DBUS_ADDR" avahi-resolve -4 --name "$hostname" 2>/dev/null | awk '{print $2; exit}')
      printf '%s\n' "${ip:-}" > "/data/mdns-resolve-${id}.result"
    done
    sleep 0.3
  done
}

log "Starting"
resolver_loop &
RESOLVER_PID=$!
sync_config
last_hash=$(get_hash "$CONFIG")

while true; do
  sleep 3
  current_hash=$(get_hash "$CONFIG")
  if [ "$current_hash" != "$last_hash" ]; then
    log "Config changed, reloading"
    sync_config
    last_hash="$current_hash"
  fi
done
