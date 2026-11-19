#!/bin/sh
# Deploying Honear: the only thing the agent account may do as root (/etc/sudoers.d/agent), with no argument. It runs nothing
# the agent could write: it pulls main from GitHub into a clone owned by root, checks that its last commit is signed by a key
# from /etc/honear-mise-en-ligne/signataires (outside any repository) and that main has not moved backwards, then runs
# deploiement/mettre-en-ligne.sh from that clone. Installed as /usr/local/sbin/honear-mettre-en-ligne, root:root, 0755: the
# procedure is in docs/architecture-actuelle.md ("L'agent IA sur le serveur").
#
#   sudo /usr/local/sbin/honear-mettre-en-ligne
set -eu
umask 022
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/root
export PATH HOME
REMOTE_URL=https://github.com/SNZMTO/honear.git
REPOSITORY=/var/lib/honear-mise-en-ligne/honear
ALLOWED_SIGNERS=/etc/honear-mise-en-ligne/signataires
refuse() { echo "$*" >&2; exit 1; }

[ "$#" -eq 0 ] || refuse "No argument: this script does one thing only."
[ "$(id -u)" = 0 ] || refuse "Run it with sudo."
[ -s "$ALLOWED_SIGNERS" ] || refuse "$ALLOWED_SIGNERS is missing: the public key that signs main."

[ -d "$REPOSITORY/.git" ] || git clone --quiet --no-checkout "$REMOTE_URL" "$REPOSITORY"
git -C "$REPOSITORY" fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main
COMMIT="$(git -C "$REPOSITORY" rev-parse origin/main)"

# A stolen GitHub account, or the agent, can push to main; it cannot sign in Mateo's place.
git -C "$REPOSITORY" -c gpg.ssh.allowedSignersFile="$ALLOWED_SIGNERS" verify-commit "$COMMIT" ||
  refuse "The last commit of main ($COMMIT) is not signed by a key from $ALLOWED_SIGNERS: nothing is deployed."
# A signature does not date a commit: main must not go back to an older version, even a signed one.
git -C "$REPOSITORY" merge-base --is-ancestor HEAD "$COMMIT" ||
  refuse "main moved backwards on GitHub ($COMMIT does not descend from the last deployed version): nothing is deployed."

git -C "$REPOSITORY" checkout --quiet --force --detach "$COMMIT"
cd "$REPOSITORY"
exec sh deploiement/mettre-en-ligne.sh
