#!/bin/sh
# La mise en ligne de Honear : le seul geste en root que le compte agent peut faire (/etc/sudoers.d/agent), sans argument. Il
# ne lance rien que l'agent puisse écrire : il tire main de GitHub dans un clone qui appartient à root, vérifie que son
# dernier commit est signé par une clé de /etc/honear-mise-en-ligne/signataires (hors de tout dépôt) et que main n'a pas
# reculé, puis lance deploiement/mettre-en-ligne.sh de ce clone. Posé en /usr/local/sbin/honear-mettre-en-ligne, root:root,
# 0755 : la procédure est dans docs/architecture-actuelle.md (« L'agent IA sur le serveur »).
#
#   sudo /usr/local/sbin/honear-mettre-en-ligne
set -eu
umask 022
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/root
export PATH HOME
ADRESSE=https://github.com/SNZMTO/honear.git
DEPOT=/var/lib/honear-mise-en-ligne/honear
SIGNATAIRES=/etc/honear-mise-en-ligne/signataires
refus() { echo "$*" >&2; exit 1; }

[ "$#" -eq 0 ] || refus "Sans argument : ce script ne fait qu'une chose."
[ "$(id -u)" = 0 ] || refus "Lance-le avec sudo."
[ -s "$SIGNATAIRES" ] || refus "$SIGNATAIRES manque : la clé publique qui signe main."

[ -d "$DEPOT/.git" ] || git clone --quiet --no-checkout "$ADRESSE" "$DEPOT"
git -C "$DEPOT" fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main
COMMIT="$(git -C "$DEPOT" rev-parse origin/main)"

# Un compte GitHub volé, ou l'agent, peut pousser sur main ; il ne peut pas signer à la place de Mateo.
git -C "$DEPOT" -c gpg.ssh.allowedSignersFile="$SIGNATAIRES" verify-commit "$COMMIT" ||
  refus "Le dernier commit de main ($COMMIT) n'est pas signé par une clé de $SIGNATAIRES : rien n'est mis en ligne."
# Une signature ne date pas un commit : main ne doit pas revenir à une version plus ancienne, signée elle aussi.
git -C "$DEPOT" merge-base --is-ancestor HEAD "$COMMIT" ||
  refus "main a reculé sur GitHub ($COMMIT ne descend pas de la dernière version posée) : rien n'est mis en ligne."

git -C "$DEPOT" checkout --quiet --force --detach "$COMMIT"
cd "$DEPOT"
exec sh deploiement/mettre-en-ligne.sh
