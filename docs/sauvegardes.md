# Les sauvegardes : les comptes des joueurs de Honear d'abord

> **Procédure prête, pas encore installée (19 octobre 2026).** Les fichiers sont dans
> [`tools/backup/`](../tools/backup/) ; rien n'est encore posé sur le serveur, et aucune sauvegarde n'existe.

## Pourquoi c'est la priorité

honear.fr a des comptes ouverts en production : des adresses e-mail et des scores, qui ne vivent que sur le disque du serveur.
Une panne, une commande de trop ou une machine compromise, et ils sont perdus, sans moyen de les rendre aux joueurs. Les
listes que le MCP enregistre sont dans le même cas. Les certificats et la configuration viennent ensuite : ils se refont.

## Ce qui est sauvegardé, où, et combien de temps

- **Quoi** : le dossier des données de Honear et celui des listes du MCP, rien d'autre.
- **Avec quoi** : [restic](https://restic.net), le paquet de Debian. Il chiffre sur le serveur, avant l'envoi : le stockage
  ne voit que des blocs illisibles. Il n'envoie que ce qui a changé.
- **Où** : hors du serveur, et dans l'Union européenne : un serveur SFTP, ou un stockage objet compatible S3. Le choix reste à
  faire ; `honear.env.example` montre les deux.
- **Quand** : chaque nuit à 4 h, quand personne ne joue et avant le redémarrage de 5 h. Une nuit manquée, serveur éteint, se
  rattrape au démarrage suivant (`Persistent=true`).
- **Combien de temps** : `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`, soit une sauvegarde par jour
  pendant une semaine, une par semaine pendant un mois, une par mois pendant six mois. Au-delà, plus rien.

| Fichier de `tools/backup/` | Son rôle | Posé dans |
|---|---|---|
| `backup.sh` | vérifie ses réglages, sauvegarde, élague | `/usr/local/lib/restic-honear/` |
| `restic-honear.service` | le lance en root, sans autre droit que de lire ; n'écrit que dans son cache | `/etc/systemd/system/` |
| `restic-honear.timer` | chaque nuit à 4 h, `Persistent=true` | `/etc/systemd/system/` |
| `honear.env.example` | le modèle de ses réglages, sans secret | `/etc/restic/honear.env`, en 0600 |

## Avant d'installer : les deux chemins

Aucun journal de ce dépôt n'écrit où Honear et son MCP gardent leurs données. `/var/lib/honear` est le chemin attendu pour
Honear ; le dossier des listes du MCP est à trouver. Ce que montent les conteneurs le dit :

```sh
sudo docker ps --format '{{.Names}}'
sudo docker inspect --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' nom-du-conteneur
```

`backup.sh` refuse un dossier qui n'existe pas : un chemin faux donnerait, chaque nuit, une sauvegarde vide qui aurait
l'air de marcher.

Si les comptes vivent dans une base SQLite, restic copie un fichier que le jeu peut écrire au même moment. La sauvegarde de
4 h tombe quand personne ne joue, et le test de restauration ouvre la base copiée. Si ce test échoue un jour, la sauvegarde
devra d'abord faire une copie cohérente (`sqlite3 base.db ".backup copie.db"`), et restic sauvegarder la copie.

## L'installation (à appliquer, pas encore fait)

Sur le serveur, depuis un clone de ce dépôt :

```sh
sudo apt install restic
sudo install -d -m 0700 /etc/restic
# Le mot de passe : tiré au hasard, lisible par root seul. Le copier aussitôt dans le gestionnaire de mots de passe :
# sans lui, aucune sauvegarde ne se relit.
sudo sh -c 'umask 077; head -c 32 /dev/urandom | base64 > /etc/restic/honear.mot-de-passe'
sudo cat /etc/restic/honear.mot-de-passe
sudo install -m 0600 tools/backup/honear.env.example /etc/restic/honear.env
sudoedit /etc/restic/honear.env      # RESTIC_REPOSITORY, HONEAR_DATA, HONEAR_MCP_LISTES
sudo install -d -m 0755 /usr/local/lib/restic-honear
sudo install -m 0755 tools/backup/backup.sh /usr/local/lib/restic-honear/
sudo install -m 0644 tools/backup/restic-honear.service tools/backup/restic-honear.timer /etc/systemd/system/
# Le dépôt restic, une fois. En SFTP, c'est aussi là que root accepte la clé du serveur distant.
sudo sh -c 'set -a; . /etc/restic/honear.env; set +a; restic init'
sudo systemctl daemon-reload
sudo systemctl start restic-honear.service && journalctl -u restic-honear -n 50 --no-pager
sudo systemctl enable --now restic-honear.timer
systemctl list-timers restic-honear
```

Puis, tout de suite, le premier test de restauration.

## Le test de restauration

Une sauvegarde qui n'a jamais été relue n'en est pas une. Le test se fait une fois l'installation finie, puis chaque mois, et
après chaque changement de Honear qui touche à ses données. Il restaure dans un dossier que root seul lit, vérifie, puis
efface : ce sont des données personnelles.

```sh
sudo -i
set -a; . /etc/restic/honear.env; set +a
restic snapshots --tag honear                            # la dernière sauvegarde, et sa date
install -d -m 0700 /root/essai-restauration
restic restore latest --tag honear --target /root/essai-restauration
diff -rq "$HONEAR_DATA" "/root/essai-restauration$HONEAR_DATA"          # seul ce qui a changé depuis diffère
diff -rq "$HONEAR_MCP_LISTES" "/root/essai-restauration$HONEAR_MCP_LISTES"
# Si les comptes sont dans une base SQLite (paquet sqlite3) : elle s'ouvre, et elle est saine.
sqlite3 "/root/essai-restauration$HONEAR_DATA/la-base.db" 'PRAGMA integrity_check;'      # ok
restic check --read-data                                 # le dépôt, et toutes ses données relues
rm -rf /root/essai-restauration
exit
```

Une vraie restauration remet en place les comptes supprimés depuis la sauvegarde : avant de rouvrir le jeu, refaire les
suppressions demandées depuis.

Chaque test se note ici, daté, même quand il échoue :

| Date | Sauvegarde restaurée (identifiant, date) | Ce qui a été vérifié | Durée | Résultat | Par |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

## Ce que demande le RGPD

L'article 32 du RGPD demande au responsable du traitement des mesures de sécurité adaptées au risque, dont, selon les besoins :

- **le chiffrement des données personnelles** (32.1.a) : restic chiffre avant l'envoi ;
- **des moyens de rétablir la disponibilité des données et l'accès à celles-ci dans des délais appropriés**, après un incident
  physique ou technique (32.1.c) : c'est la sauvegarde ;
- **une procédure pour tester, analyser et évaluer régulièrement l'efficacité de ces mesures** (32.1.d) : c'est le test de
  restauration, et son tableau.

Perdre les comptes sans sauvegarde serait une violation de données (l'article 4.12 compte la perte), à noter, et à notifier
à la CNIL dans les 72 heures si elle présente un risque pour les joueurs (article 33). Les sauvegardes entrent aussi au
registre de Honear : où elles sont (le prestataire du stockage est un sous-traitant), combien de temps elles durent (six mois
au plus), et la page de confidentialité du jeu le dit.
