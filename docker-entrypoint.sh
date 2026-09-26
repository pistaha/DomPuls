#!/bin/sh
set -eu

data_dir=${DATA_DIR:-/data}
if [ "$data_dir" != "/data" ]; then
  echo "Production DATA_DIR must be /data so the Railway Volume stays writable." >&2
  exit 1
fi

# Railway attaches Volumes as root-owned mounts after the image is built.
# Fix only the dedicated data mount, then drop privileges before starting Node.
mkdir -p /data
chown -R node:node /data
exec gosu node:node "$@"
