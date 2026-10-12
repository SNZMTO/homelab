#!/bin/sh
# Construit mateosan.fr tel qu'il est servi, depuis une copie du dépôt : l'export de Claude Design (site/), les pages légales
# (legal/) et les dépendances rapatriées (dependances/). Les adresses des CDN y deviennent celles de leurs copies, les liens vers
# les pages légales s'ajoutent à la page d'accueil, et il refuse un site qui chargerait encore quelque chose d'ailleurs. Il ne lit
# le dépôt que comme des données : il n'en exécute rien.
#
#   sh construire.sh <copie du dépôt> <dossier à créer>
set -eu
SOURCE="$1"
CIBLE="$2"
CDN='unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|esm\.sh'
ADRESSE="[^\"'\` )<>]*"
refus() { echo "$*" >&2; exit 1; }

[ -f "$SOURCE/site/index.html" ] || refus "Pas de site/index.html dans $SOURCE."
[ -f "$SOURCE/dependances/LISTE" ] || refus "Pas de dependances/LISTE dans $SOURCE."
[ -f "$SOURCE/legal/_liens.html" ] || refus "Pas de legal/_liens.html dans $SOURCE."
[ ! -e "$CIBLE" ] || refus "$CIBLE existe déjà."
# Un lien symbolique ferait servir un fichier hors du site : aucun n'est accepté.
[ -z "$(find "$SOURCE/site" "$SOURCE/legal" "$SOURCE/dependances" -type l)" ] || refus "Le dépôt contient un lien symbolique."

mkdir -p "$CIBLE/dependances"
cp -R "$SOURCE/site/." "$CIBLE/"
cp -R "$SOURCE/dependances/." "$CIBLE/dependances/"
rm "$CIBLE/dependances/LISTE"
# Les pages légales, à la racine du site ; _liens.html n'est qu'un morceau, ajouté à la page d'accueil.
for fichier in "$SOURCE"/legal/*; do
  nom="${fichier##*/}"
  case "$nom" in _*) continue ;; esac
  [ ! -e "$CIBLE/$nom" ] || refus "legal/$nom existe aussi dans site/."
  cp "$fichier" "$CIBLE/"
done

perl - "$CIBLE" "$SOURCE/dependances/LISTE" "$SOURCE/legal/_liens.html" <<'PERL'
use strict;
use warnings;
my ($cible, $liste, $liens) = @ARGV;
my %copie;
open my $l, '<', $liste or die "$liste : $!\n";
while (<$l>) {
  chomp;
  next unless /\S/;
  my ($adresse, $chemin) = split / /;
  $copie{$adresse} = "/dependances/$chemin";
}
close $l;
my $morceau = do { local $/; open my $f, '<', $liens or die "$liens : $!\n"; <$f> };

opendir my $d, $cible or die "$cible : $!\n";
for my $nom (grep { /\.(html|js|css)$/ } readdir $d) {
  my $fichier = "$cible/$nom";
  my $texte = do { local $/; open my $f, '<:raw', $fichier or die "$fichier : $!\n"; <$f> };
  # Les plus longues d'abord : aucune adresse n'en abîme une autre qui la contiendrait.
  for my $adresse (sort { length($b) <=> length($a) } keys %copie) {
    (my $en_html = $adresse) =~ s/&/&amp;/g;
    $texte =~ s/\Q$en_html\E/$copie{$adresse}/g;
    $texte =~ s/\Q$adresse\E/$copie{$adresse}/g;
  }
  # Se préparer à joindre un CDN ne sert plus à rien.
  $texte =~ s{[ \t]*<link\b[^>]*\brel="(?:preconnect|dns-prefetch)"[^>]*>[ \t]*\n?}{}g;
  if ($nom eq 'index.html') {
    $texte =~ s{</body>}{$morceau</body>} or die "index.html n'a pas de </body> : les liens vers les pages légales n'ont nulle part où aller.\n";
  }
  open my $f, '>:raw', $fichier or die "$fichier : $!\n";
  print $f $texte;
  close $f;
}
PERL

# Ce qui chargerait encore quelque chose d'un CDN : une version qui a changé dans un export de Claude Design.
pages() { find "$CIBLE" -maxdepth 1 -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -print0; }
if pages | xargs -0 grep -noE "(https?:)?//($CDN)/$ADRESSE"; then
  refus "Ces adresses ne sont pas dans dependances/LISTE : lance sh deploiement/dependances.sh, puis commite dependances/."
fi
# Chaque copie citée existe.
for chemin in $({ pages; find "$CIBLE/dependances" -name '*.css' -print0; } | xargs -0 grep -ohE "/dependances/$ADRESSE" | sort -u); do
  [ -f "$CIBLE$chemin" ] || refus "$chemin est cité mais n'existe pas."
done
