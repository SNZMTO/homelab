#!/bin/sh
# Met mateosan.fr en ligne sur le VPS, la première fois, puis à chaque changement de deploiement/ : crée l'utilisateur mateosan
# (sans shell ni droits) et ses dossiers, pose le serveur dans /srv/mateosan, construire.sh et publier.sh dans
# /usr/local/lib/mateosan, le timer dans systemd ; met en ligne le dernier commit de GitHub, construit l'image du serveur et
# (re)lance son conteneur. Ensuite, le timer suit GitHub tout seul : un push sur main est en ligne dans les deux minutes. Ce qui est
# posé ici est toujours un commit, déjà poussé sur GitHub : il refuse un dépôt qui a des changements. Le frontal (dépôt « vps »)
# doit connaître le réseau « mateosan ».
#
#   sudo sh deploiement/mettre-en-ligne.sh
set -eu
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/.." && pwd)"
CIBLE=/srv/mateosan
OUTILS=/usr/local/lib/mateosan
DOMAINE=mateosan.fr
[ "$(id -u)" = 0 ] || { echo "Lance-le avec sudo."; exit 1; }
command -v docker >/dev/null || { echo "Docker n'est pas là : prépare d'abord le VPS (dépôt « vps », sudo sh preparer.sh)."; exit 1; }
if [ -n "$(git -c safe.directory="$RACINE" -C "$RACINE" status --porcelain)" ]; then
  echo "Le dépôt a des changements qui ne sont pas commités : commite-les d'abord."
  exit 1
fi

printf '== L’utilisateur mateosan et ses dossiers\n'
id mateosan >/dev/null 2>&1 ||
  useradd --system --user-group --home-dir /var/lib/mateosan --no-create-home --shell /usr/sbin/nologin mateosan
install -d -m 0755 "$CIBLE" "$OUTILS"
install -d -m 0755 -o mateosan -g mateosan /var/lib/mateosan "$CIBLE/publie"

printf '== Le serveur, les outils et le timer\n'
install -m 0644 "$ICI/compose.yaml" "$ICI/Caddyfile" "$CIBLE/"
install -m 0755 "$ICI/construire.sh" "$ICI/publier.sh" "$OUTILS/"
install -m 0644 "$ICI/systemd/mateosan-publier.service" "$ICI/systemd/mateosan-publier.timer" /etc/systemd/system/
systemctl daemon-reload

printf '== Le dernier commit de GitHub\n'
if ! systemctl start mateosan-publier.service; then
  journalctl -u mateosan-publier.service -n 20 -o cat --no-pager
  exit 1
fi
systemctl enable --now mateosan-publier.timer

printf '== Le conteneur\n'
docker build -q -t mateosan-site "$ICI" >/dev/null
docker compose --project-directory "$CIBLE" up -d --wait --force-recreate --remove-orphans

printf '== Vérifications\n'
VERSION="$(readlink "$CIBLE/publie/actuel" | sed 's#versions/##')"
# Les liens vers les pages légales : seul le site les a, pas une page d'attente du frontal.
if curl -fsS --max-time 15 "https://$DOMAINE/" 2>/dev/null | grep -q 'class="liens-legaux"'; then
  printf 'En ligne : https://%s (version %s)\n' "$DOMAINE" "$VERSION"
else
  echo "Le site tourne (version $VERSION), mais https://$DOMAINE ne le sert pas : le frontal passe-t-il mateosan.fr au réseau"
  echo "« mateosan » ? (dépôt « vps », sudo sh frontal/mettre-en-ligne.sh). Ce que dit le site :"
  echo "sudo docker compose --project-directory $CIBLE logs --tail 50"
  exit 1
fi
