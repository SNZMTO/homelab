#!/bin/sh
# Met en ligne le dernier commit de SNZMTO/homelab (branche main), s'il ne l'est pas déjà : le lit sur GitHub sans compte (le dépôt
# est public : aucun secret sur le VPS), le construit à côté de la version en ligne, puis bascule d'un coup. Les trois dernières
# versions restent. Lancé toutes les deux minutes par mateosan-publier.timer, en tant que mateosan, qui n'écrit que là ; il
# exécute sa copie de construire.sh, posée par mettre-en-ligne.sh, jamais un script venu de GitHub.
#
#   sudo systemctl start mateosan-publier          (sans attendre le timer)
#   journalctl -u mateosan-publier -n 20           (ce qu'il a fait)
set -eu
ADRESSE=https://github.com/SNZMTO/homelab.git
DEPOT=/var/lib/mateosan/depot.git
PUBLIE=/srv/mateosan/publie
CONSTRUIRE=/usr/local/lib/mateosan/construire.sh

[ -d "$DEPOT" ] || git init --quiet --bare "$DEPOT"
git -C "$DEPOT" fetch --quiet --no-tags "$ADRESSE" +refs/heads/main:refs/heads/main
VERSION="$(git -C "$DEPOT" rev-parse --short=12 main)"
[ "$(readlink "$PUBLIE/actuel" 2>/dev/null || true)" != "versions/$VERSION" ] || exit 0

if [ ! -d "$PUBLIE/versions/$VERSION" ]; then
  TRAVAIL="$(mktemp -d)"
  trap 'rm -rf "$TRAVAIL"' EXIT
  mkdir "$TRAVAIL/depot"
  git -C "$DEPOT" archive main site legal dependances | tar -x -C "$TRAVAIL/depot"
  sh "$CONSTRUIRE" "$TRAVAIL/depot" "$TRAVAIL/site"
  mkdir -p "$PUBLIE/versions"
  cp -R "$TRAVAIL/site" "$PUBLIE/versions/$VERSION.nouveau"
  mv "$PUBLIE/versions/$VERSION.nouveau" "$PUBLIE/versions/$VERSION"
fi
# La bascule : un lien qu'on remplace d'un coup ; le serveur lit la nouvelle version dès la requête suivante.
ln -sfn "versions/$VERSION" "$PUBLIE/actuel.nouveau"
mv -T "$PUBLIE/actuel.nouveau" "$PUBLIE/actuel"
touch "$PUBLIE/versions/$VERSION"
echo "En ligne : $VERSION"

# Le ménage : les trois dernières versions restent.
ls -1t "$PUBLIE/versions" | tail -n +4 | while read -r ancienne; do
  rm -rf "${PUBLIE:?}/versions/$ancienne"
done
