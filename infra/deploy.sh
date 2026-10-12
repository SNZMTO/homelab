#!/bin/bash
set -euo pipefail

REPO="/home/deploy/homelab"
SRC="$REPO/site/"
DEST="/opt/mateosan/site/"

cd "$REPO"

BEFORE=$(git rev-parse HEAD)
git pull --quiet
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    exit 0
fi

rsync -a --delete "$SRC" "$DEST"
echo "$(date -Iseconds) : deploiement $BEFORE -> $AFTER"
