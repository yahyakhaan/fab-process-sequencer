#!/usr/bin/env bash
set -euo pipefail

image_name="fab-process-sequencer:smoke"
container_id=""
port="13000"

cleanup() {
  if [[ -n "${container_id}" ]]; then
    docker rm --force "${container_id}" >/dev/null
  fi
}
trap cleanup EXIT

docker build --tag "${image_name}" .
container_id="$(docker run --detach --publish "127.0.0.1:${port}:10000" "${image_name}")"

for _ in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${port}/readyz" >/dev/null; then
    curl --fail --silent "http://127.0.0.1:${port}/" | grep --quiet "Fab Process Sequencer"
    exit 0
  fi
  sleep 1
done

docker logs "${container_id}"
exit 1
