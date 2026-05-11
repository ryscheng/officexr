#!/usr/bin/env bash
# Swap the realtime container started by `pnpm supabase:test:start` over
# to a known-good newer image, then apply our dev tenant config.
#
# Why: the supabase CLI we're pinned to ships realtime v2.86.3 which has
# a bug where receiving a broadcast closes the recipient's channel
# (manifests as "Realtime send() falling back to REST" warnings + "send
# ack: error" loops in the multi-bot debug). v2.93.3 fixes it.
#
# Idempotent: safe to run any time after `supabase:test:start`. Picks up
# saved env from the existing container before recreating, so it inherits
# whatever JWT / DB / network configuration the CLI just baked in.
set -euo pipefail

CONTAINER_PREFIX="${SUPABASE_CONTAINER_PREFIX:-supabase_realtime_officexr-test}"
TARGET_IMAGE="${REALTIME_IMAGE:-public.ecr.aws/supabase/realtime:v2.93.3}"
NETWORK="${SUPABASE_NETWORK:-supabase_network_officexr-test}"

if ! command -v podman >/dev/null 2>&1; then
  echo "podman not found" >&2
  exit 1
fi

if ! podman container exists "$CONTAINER_PREFIX"; then
  echo "container $CONTAINER_PREFIX not found — start supabase first" >&2
  exit 1
fi

current=$(podman inspect "$CONTAINER_PREFIX" --format '{{.Config.Image}}' 2>/dev/null || echo unknown)
if [[ "$current" == "$TARGET_IMAGE" ]]; then
  echo "realtime already on $TARGET_IMAGE — applying tenant config only"
else
  echo "current realtime image: $current — upgrading to $TARGET_IMAGE"

  envfile=$(mktemp)
  trap 'rm -f "$envfile"' EXIT
  # Capture the container's env, drop empty entries (podman --env-file
  # rejects KEY= without a value).
  podman inspect "$CONTAINER_PREFIX" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -vE "^$|^[A-Z_]+=$|^[A-Z_]+=''$" > "$envfile"

  podman stop "$CONTAINER_PREFIX" >/dev/null
  podman rm "$CONTAINER_PREFIX" >/dev/null

  podman run -d \
    --name "$CONTAINER_PREFIX" \
    --network "$NETWORK" \
    --network-alias realtime \
    --network-alias realtime-dev \
    --env-file "$envfile" \
    "$TARGET_IMAGE" \
    /app/bin/server >/dev/null

  # Wait for it to be ready before applying tenant config.
  for _ in $(seq 1 20); do
    if podman exec "$CONTAINER_PREFIX" sh -c 'wget -q -O- http://127.0.0.1:4000/api/health 2>/dev/null' >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

# Apply dev tenant limits + presence_enabled + adapter. Idempotent.
sql_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
podman exec -i "${CONTAINER_PREFIX/realtime/db}" sh -c \
  'PGPASSWORD=postgres psql -U supabase_admin -d postgres -h 127.0.0.1' \
  < "$sql_dir/raise-dev-limits.sql" >/dev/null

echo "realtime $TARGET_IMAGE up; tenant config applied"
