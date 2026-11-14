#!/usr/bin/env bash
# Run on the Linux server from its stable deployment checkout.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
image=${1:?Usage: bash deploy/release.sh IMAGE_TAG_OR_DIGEST}
[[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$ ]] || { echo 'Invalid image reference.' >&2; exit 1; }
[[ -f deploy/container.env ]] || { echo 'Create private deploy/container.env first.' >&2; exit 1; }
command -v flock >/dev/null || { echo 'Install util-linux (flock) first.' >&2; exit 1; }
mkdir -p .release
exec 9>.release/lock
flock -n 9 || { echo 'Another release is running.' >&2; exit 1; }
export SESORA_IMAGE="$image"
docker compose version >/dev/null
docker compose config --quiet
previous=''
[[ ! -f .release/current ]] || previous=$(cat .release/current)
# Pull both images BEFORE stopping anything. Never prune the rollback image.
docker pull "$image"
if [[ -n "$previous" ]]; then
  [[ "$previous" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$ ]] || exit 1
  docker image inspect "$previous" >/dev/null 2>&1 || docker pull "$previous"
fi
attempts=${HEALTH_ATTEMPTS:-30}
interval=${HEALTH_INTERVAL_SECONDS:-4}
[[ "$attempts" =~ ^[1-9][0-9]*$ && "$interval" =~ ^[0-9]+$ ]] || { echo 'Invalid health wait configuration.' >&2; exit 1; }
healthy() {
  local id status
  for (( n=0; n<attempts; n++ )); do
    id=$(docker compose ps -q app) || return 1
    if [[ -n "$id" ]]; then
      status=$(docker inspect --format '{{.State.Health.Status}}' "$id") || return 1
      [[ "$status" != healthy ]] || return 0
    fi
    sleep "$interval"
  done
  return 1
}
recover() {
  trap - HUP INT TERM
  echo 'Release failed. Stopping candidate.' >&2
  docker compose stop --timeout 35 app || { echo 'Could not stop candidate; recovery needs inspection.' >&2; exit 2; }
  if [[ -z "$previous" ]]; then
    echo 'First deployment: no previous managed release to restore.' >&2
    exit 1
  fi
  export SESORA_IMAGE="$previous"
  if docker compose up -d --no-deps --force-recreate app && healthy; then
    echo "Previous release restored: $previous" >&2
    exit 1
  fi
  echo 'Rollback health check failed; inspect the server.' >&2
  exit 2
}
trap recover HUP INT TERM
# A controlled stop releases the WhatsApp lease before the replacement starts.
if docker compose stop --timeout 35 app && docker compose up -d --no-deps --force-recreate app && healthy; then
  if [[ -n "$previous" && "$previous" != "$image" ]]; then
    printf '%s\n' "$previous" > .release/previous.tmp
    mv .release/previous.tmp .release/previous
  fi
  printf '%s\n' "$image" > .release/current.tmp
  mv .release/current.tmp .release/current
  trap - HUP INT TERM
  echo "Release healthy: $image"
else
  recover
fi
