#!/bin/sh
# Backs up Honear's data (the players' accounts) and its MCP's lists with restic: encrypted on the server, sent off the
# server, then pruned (seven days, four weeks, six months). Run every night by restic-honear.timer, as root, to read folders
# that belong to the containers; its settings come from /etc/restic/honear.env (the template: honear.env.example). Installed
# in /usr/local/lib/restic-honear; the installation and the restore test are in docs/sauvegardes.md.
#
#   sudo systemctl start restic-honear       (without waiting for the timer)
#   journalctl -u restic-honear -n 50        (what it did)
set -eu
refuse() { echo "$*" >&2; exit 1; }

: "${RESTIC_REPOSITORY:?missing from /etc/restic/honear.env: where the backups go}"
: "${RESTIC_PASSWORD_FILE:?missing from /etc/restic/honear.env: the password file}"
: "${HONEAR_DATA:?missing from /etc/restic/honear.env: the folder of Honear's data}"
: "${HONEAR_MCP_LISTES:?missing from /etc/restic/honear.env: the folder of the MCP's lists}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

# The password opens every backup: only root reads it.
[ "$(stat -c '%u %a' "$RESTIC_PASSWORD_FILE" 2>/dev/null)" = "0 600" ] ||
  refuse "$RESTIC_PASSWORD_FILE must exist, belong to root and be 0600."
# A wrong path would give, every night, an empty backup that looks like it works.
for folder in "$HONEAR_DATA" "$HONEAR_MCP_LISTES"; do
  [ -d "$folder" ] || refuse "$folder does not exist: nothing is backed up."
done

restic backup --tag honear "$HONEAR_DATA" "$HONEAR_MCP_LISTES"
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
