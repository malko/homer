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
  # Match pairs of "domain":"..." and "ip":"..." on the same line/object
  sed -n 's/.*"domain"[[:space:]]*:[[:space:]]*"\([^"]*\)"[^}]*"ip"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1\t\2/p' "$CONFIG" | \
  while IFS="$(printf '\t')" read -r domain ip; do
    [ -z "$domain" ] || [ -z "$ip" ] && continue
    log "Publishing A $domain -> $ip"
    DBUS_SYSTEM_BUS_ADDRESS="$DBUS_ADDR" avahi-publish -a -R "$domain" "$ip" &
  done
}

publish_services() {
  # Each line: "_homer._tcp"\t"name"\t"port"\t"txt1"\t"txt2"\t...
  # We parse the services array with a sed trick: extract each service object block.
  awk '
    BEGIN { depth=0; inarr=0; buf="" }
    {
      line=$0
      for (i=1; i<=length(line); i++) {
        c=substr(line,i,1)
        if (!inarr) {
          buf=buf c
          if (match(buf, /"services"[[:space:]]*:[[:space:]]*\[/)) { inarr=1; buf=""; depth=0 }
          continue
        }
        if (c=="{") { depth++; buf=buf c; continue }
        if (c=="}") { depth--; buf=buf c; if (depth==0) { print buf; buf="" }; continue }
        if (c=="]" && depth==0) { inarr=0; continue }
        if (depth>0) buf=buf c
      }
    }
  ' "$CONFIG" | while IFS= read -r obj; do
    [ -z "$obj" ] && continue
    svc_type=$(printf '%s' "$obj" | sed -n 's/.*"type"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    svc_name=$(printf '%s' "$obj" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    svc_port=$(printf '%s' "$obj" | sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p')
    [ -z "$svc_type" ] || [ -z "$svc_name" ] || [ -z "$svc_port" ] && continue

    # Build txt args: extract strings from "txt": [ "a=b", "c=d" ]
    txt_block=$(printf '%s' "$obj" | sed -n 's/.*"txt"[[:space:]]*:[[:space:]]*\(\[[^]]*\]\).*/\1/p')
    # Write args to a tmp file, one per line, then read back
    : > /tmp/_txt_args
    printf '%s' "$txt_block" | sed -n 's/"\([^"]*\)"/\1\n/gp' | while IFS= read -r t; do
      [ -n "$t" ] && printf '%s\n' "$t" >> /tmp/_txt_args
    done

    log "Publishing service $svc_name ($svc_type port $svc_port)"
    # Build an sh command safely
    set -- "$svc_name" "$svc_type" "$svc_port"
    while IFS= read -r t; do
      set -- "$@" "$t"
    done < /tmp/_txt_args

    DBUS_SYSTEM_BUS_ADDRESS="$DBUS_ADDR" avahi-publish -s "$@" &
  done
  rm -f /tmp/_txt_args
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
      ip=$(DBUS_SYSTEM_BUS_ADDRESS="$DBUS_ADDR" avahi-resolve --name "$hostname" 2>/dev/null | awk '{print $2; exit}')
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
