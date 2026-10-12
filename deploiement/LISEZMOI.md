# mateosan.fr sur le VPS

Le site vit sur le VPS OVH, à côté d'autres sites (honear.fr). La machine durcie et le frontal Caddy, partagés, sont dans le dépôt
`vps` (`~/vps` sur le VPS) ; ce dossier-ci ne tient que ce qui est propre à mateosan.fr.

```
Claude Design ──publier.ps1──▶ GitHub (main) ──toutes les 2 min──▶ /srv/mateosan/publie/actuel ──▶ conteneur « mateosan »
                                                                                                      ▲ réseau « mateosan »
                                                    internet ──HTTPS──▶ frontal (Caddy, dépôt vps) ───┘
```

## Ce qui est en ligne

- **Le site** est l'export de Claude Design (`site/`), plus les pages légales (`legal/`) et les dépendances rapatriées
  (`dependances/`). `construire.sh` les assemble : les adresses des CDN deviennent celles des copies, et les liens « Mentions
  légales » et « Confidentialité » s'ajoutent en bas de la page d'accueil. Le site ne charge rien d'ailleurs : ni Google Fonts,
  ni unpkg, ni cdnjs. Aucun visiteur ne donne son adresse IP à un tiers, et la page « Confidentialité » peut le dire.
- **Le conteneur** sert le site : le Caddy du frontal, sans capacité, en tant que `nobody`, en lecture seule, sans port publié.
  Il pose la CSP du site ; le frontal tient le HTTPS et les en-têtes de sécurité communs.
- **Le déploiement** reste celui de la phase 4 : le VPS tire, rien ne pousse vers lui. Le timer `mateosan-publier` regarde
  GitHub toutes les deux minutes, en tant que `mateosan` (sans shell ni droits, qui n'écrit que dans son dépôt et dans le site),
  construit le nouveau commit à côté de la version en ligne et bascule d'un coup. Il n'exécute jamais un script venu de GitHub :
  ses outils sont posés par `mettre-en-ligne.sh`. Un commit cassé ne passe pas : la version d'avant reste en ligne.

## Au quotidien

Publier une modification : `publier.ps1` sur le PC, comme avant. Le site est à jour dans les deux minutes.

- **Avant le premier `publier.ps1`** : `git pull` dans le clone du PC (ce dossier, `legal/` et `dependances/` y sont arrivés).
- **Si la publication ne vient pas** : `journalctl -u mateosan-publier -n 20` sur le VPS dit pourquoi. Le plus probable : un
  export qui charge une nouvelle version de React, three.js ou une autre police. Alors `sh deploiement/dependances.sh`, puis
  commiter `dependances/` et pousser.
- **Revenir en arrière** : `git revert` du commit fautif, puis pousser.
- **Les pages légales** se modifient dans `legal/` (la date en haut de chaque page aussi), puis commit et push.

## Sur le VPS

| Fichier | Rôle |
| --- | --- |
| `mettre-en-ligne.sh` | `sudo sh deploiement/mettre-en-ligne.sh` : la première fois, et après chaque changement de ce dossier (commité et poussé). |
| `publier.sh`, `systemd/` | Le timer et ce qu'il fait ; posés dans `/usr/local/lib/mateosan` et `/etc/systemd/system`. |
| `construire.sh` | Assemble le site servi ; refuse un site qui chargerait encore quelque chose d'un CDN. |
| `dependances.sh` | Rapatrie dans `dependances/` ce que l'export chargerait d'un CDN (à lancer sur le PC ou le VPS). |
| `Dockerfile`, `compose.yaml`, `Caddyfile` | Le conteneur et son serveur ; posés dans `/srv/mateosan`. |

- `systemctl list-timers mateosan-publier` : le prochain passage ; `sudo systemctl start mateosan-publier` : tout de suite.
- `sudo docker compose --project-directory /srv/mateosan ps` : l'état du conteneur.
- `ls -l /srv/mateosan/publie` : la version en ligne (`actuel`) et les deux d'avant.

## À savoir

- Le frontal interdit à toutes les pages l'accès au gyroscope (en-tête `Permissions-Policy` du dépôt `vps`). La scène 3D sait
  suivre l'inclinaison du téléphone, mais ce n'est branché nulle part aujourd'hui ; le jour où ça l'est, il faudra l'autoriser
  pour mateosan.fr dans le Caddyfile du frontal.
- La section « Contact / CV » attend encore le nom, l'e-mail, les liens et le CV : à remplir dans Claude Design.
