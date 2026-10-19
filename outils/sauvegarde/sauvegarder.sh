#!/bin/sh
# Sauvegarde avec restic les données de Honear (les comptes des joueurs) et les listes de son MCP : chiffrées sur le serveur,
# envoyées hors du serveur, puis élaguées (sept jours, quatre semaines, six mois). Lancé chaque nuit par restic-honear.timer,
# en root, pour lire des dossiers qui appartiennent aux conteneurs ; ses réglages viennent de /etc/restic/honear.env (le
# modèle : honear.env.exemple). Posé dans /usr/local/lib/restic-honear ; l'installation et le test de restauration sont dans
# docs/sauvegardes.md.
#
#   sudo systemctl start restic-honear       (sans attendre le timer)
#   journalctl -u restic-honear -n 50        (ce qu'il a fait)
set -eu
refus() { echo "$*" >&2; exit 1; }

: "${RESTIC_REPOSITORY:?manque dans /etc/restic/honear.env : où vont les sauvegardes}"
: "${RESTIC_PASSWORD_FILE:?manque dans /etc/restic/honear.env : le fichier du mot de passe}"
: "${HONEAR_DONNEES:?manque dans /etc/restic/honear.env : le dossier des données de Honear}"
: "${HONEAR_MCP_LISTES:?manque dans /etc/restic/honear.env : le dossier des listes du MCP}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

# Le mot de passe ouvre toutes les sauvegardes : root seul le lit.
[ "$(stat -c '%u %a' "$RESTIC_PASSWORD_FILE" 2>/dev/null)" = "0 600" ] ||
  refus "$RESTIC_PASSWORD_FILE doit exister, appartenir à root et être en 0600."
# Un chemin faux donnerait, chaque nuit, une sauvegarde vide qui aurait l'air de marcher.
for dossier in "$HONEAR_DONNEES" "$HONEAR_MCP_LISTES"; do
  [ -d "$dossier" ] || refus "$dossier n'existe pas : rien n'est sauvegardé."
done

restic backup --tag honear "$HONEAR_DONNEES" "$HONEAR_MCP_LISTES"
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
