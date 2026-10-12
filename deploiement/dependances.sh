#!/bin/sh
# Rapatrie dans dependances/ ce que le site chargerait depuis un CDN (React, Babel, three.js, les polices de Google) : servi depuis
# mateosan.fr, rien ne part ailleurs, et aucun visiteur ne donne son adresse IP à un tiers (voir la page « Confidentialité »).
# dependances/LISTE dit, pour chaque adresse d'un CDN, où est sa copie ; construire.sh s'en sert, et refuse un site qui chargerait
# encore quelque chose d'un CDN. À relancer quand un export de Claude Design change une version, puis commiter dependances/.
#
#   sh deploiement/dependances.sh
set -eu
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
DEPENDANCES="$RACINE/dependances"
LISTE="$DEPENDANCES/LISTE"
CDN='unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|esm\.sh'
# Google ne sert ses polices en woff2 qu'aux navigateurs qui le lisent : on se présente comme l'un d'eux.
NAVIGATEUR='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
touch "$LISTE"

telecharger() { # adresse, chemin dans dependances/
  mkdir -p "$(dirname "$DEPENDANCES/$2")"
  curl -fsSL --proto '=https' -A "$NAVIGATEUR" -o "$DEPENDANCES/$2" "$1"
}

grep -ohE "https://($CDN)/[^\"'\` )<>]+" "$RACINE"/site/*.html "$RACINE"/site/*.js | sed 's/&amp;/\&/g' | sort -u |
  while read -r adresse; do
    grep -qF -- "$adresse " "$LISTE" && continue
    case "$adresse" in
      https://fonts.googleapis.com/*)
        # La feuille de Google, et chaque police qu'elle cite : la copie de la feuille pointe sur la copie des polices.
        chemin="fonts.googleapis.com/$(printf '%s' "$adresse" | sha256sum | cut -c1-16).css"
        telecharger "$adresse" "$chemin"
        grep -oE 'https://fonts\.gstatic\.com/[^)]+' "$DEPENDANCES/$chemin" | sort -u | while read -r police; do
          telecharger "$police" "${police#https://}"
        done
        sed -i 's#https://fonts\.gstatic\.com/#/dependances/fonts.gstatic.com/#g' "$DEPENDANCES/$chemin"
        ;;
      *)
        chemin="${adresse#https://}"
        telecharger "$adresse" "$chemin"
        ;;
    esac
    printf '%s %s\n' "$adresse" "$chemin" >> "$LISTE"
    echo "Rapatrié : $adresse"
  done
echo "dependances/ est à jour : commite-le."
