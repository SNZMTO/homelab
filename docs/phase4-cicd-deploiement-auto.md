# Phase 4 — CI/CD : déploiement automatique du site (pull par timer systemd)

**Objectif :** automatiser la mise en ligne du portfolio. Un `git push` sur GitHub
suffit ; le VPS met le site à jour tout seul, sans intervention. Fin du `scp` manuel.

**Machine :** VPS OVH, Debian 13. Repo : `SNZMTO/homelab` (public).

---

## Décision d'architecture — pull, pas push

Deux modèles possibles :
- **A (push)** : GitHub Actions se connecte en SSH au VPS et dépose les fichiers.
- **B (pull)** : le VPS va lui-même chercher les nouveautés sur GitHub.

**Choix : B (pull).** Raisonnement (dans l'esprit Phase 1, moindre privilège /
réduction de surface) :
- Aucun accès entrant à ouvrir : le SSH du VPS reste fermé, aucune clé de
  déploiement ne quitte le serveur.
- **Confinement du rayon de souffle** : si le compte GitHub est compromis,
  l'attaquant peut salir le repo mais n'a **aucun chemin vers le VPS**.
- Repo public → `git pull` anonyme en lecture seule → **zéro secret sur le VPS**.

Sous-variante retenue : **B1, pull par polling** (timer systemd toutes les 2 min),
plutôt que B2 (webhook), car le webhook rouvrirait un service exposé. Pour un
portfolio, 2 min de latence sont sans importance. Bonus pédagogique : réutilise le
mécanisme de timer systemd déjà vu en séance 1.5.

## Utilisateur de service dédié : `deploy`

Créé sans privilèges, principe du moindre privilège appliqué à un robot :
```bash
sudo useradd --system --create-home --home-dir /home/deploy --shell /usr/sbin/nologin deploy
```
- Pas de sudo, pas de mot de passe, `nologin` (aucun shell interactif possible).
- Jamais ajouté aux `AllowUsers` SSH → aucune connexion entrante sous cette identité.
- Seul systemd lance des processus sous `deploy`, localement.

## Nettoyage préalable — dissonance repo / VPS (piège majeur)

**Constat :** le repo GitHub ne contenait PAS l'artefact déployé, mais l'export brut
de Claude Design : mauvais dossier (`sites/homelab_sites/`), mauvais nom de fichier
d'entrée (`Etabli.dc.html` au lieu de `index.html`), plus des fichiers parasites de
prévisualisation (`screenshots/`, `.thumbnail`, `uploads/`).

→ Brancher le déploiement auto dans cet état aurait **écrasé le site en ligne par une
version non-déployable** (Caddy cherche `index.html`, absent du repo).

**Résolution :** la source de vérité *déployable* était sur le VPS
(`/opt/mateosan/site/` : `index.html` + `etabli-scene.js` + `support.js`, 3 fichiers
autonomes, scène 3D en pur code Three.js sans assets externes). Ces 3 fichiers ont été
rapatriés (scp descendant) et poussés dans un dossier propre `site/` (singulier, aligné
avec le VPS), remplaçant l'ancien `sites/`.

**Enseignement :** le code source (export Claude Design) et l'artefact déployé ne sont
pas la même chose. C'est *pourquoi* un pipeline a une étape de « build » entre le dépôt
et la mise en ligne.

## Clone initial (sous l'identité deploy)

```bash
sudo -u deploy git clone https://github.com/SNZMTO/homelab.git /home/deploy/homelab
```
Clone HTTPS anonyme (repo public) → aucun secret requis.

## Le script de déploiement — /home/deploy/deploy.sh

```bash
#!/bin/bash
set -euo pipefail

REPO="/home/deploy/homelab"
SRC="$REPO/site/"
DEST="/opt/mateosan/site/"

cd "$REPO"

BEFORE=$(git rev-parse HEAD)
git pull --quiet
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    exit 0
fi

rsync -a --delete "$SRC" "$DEST"
echo "$(date -Iseconds) : deploiement $BEFORE -> $AFTER"
```

Points clés :
- `set -euo pipefail` : échec propre à la première erreur, pas de dégât silencieux.
- Détection par comparaison de HEAD (`git rev-parse`) avant/après pull → n'agit que
  s'il y a du neuf.
- `rsync -a --delete` : le `--delete` retire côté destination ce qui a disparu du repo.
- **Piège rsync** : le `/` final sur `$SRC` = « le *contenu* de site/ », pas le dossier
  lui-même. Sans lui, rsync créerait `/opt/mateosan/site/site/`.

## Permissions — l'itération qui a demandé le plus de réflexion

Problème : `deploy` doit écrire dans `/opt/mateosan/site/`, qui appartenait à `debian`.

Étapes successives (chaque erreur rsync a affiné le diagnostic) :
1. Groupe partagé `web` (membres : `debian` + `deploy`) + setgid sur le dossier
   (`chmod g+s`) pour que les fichiers créés héritent du groupe.
2. `rsync -a` échouait sur `chgrp` puis sur `set times` du dossier destination :
   `-a` (archive) tente de préserver des **attributs du dossier de destination** que
   `deploy` n'avait pas le droit de modifier (pas propriétaire du dossier).
3. **Correction racine** (traiter la cause, pas le symptôme) :
   `sudo chown deploy /opt/mateosan/site` → `deploy` devient propriétaire du dossier,
   `rsync -a` peut alors tout gérer nativement. Script simplifié (plus de `--no-owner`
   / `--no-group` / `chgrp` empilés).

**Enseignement :** quand on empile les exceptions d'un outil (`--no-times`,
`--no-group`...), c'est souvent qu'on traite un symptôme. Ici la cause était « écrire
dans un dossier qu'on ne possède pas » → changer le propriétaire = solution propre.

**Note / dette mineure :** après le `chown`, le dossier est repassé `deploy:deploy`
sans setgid, et les fichiers déployés sont en `-rw-r--r--` groupe `deploy`. Sans impact
fonctionnel (Caddy lit en `r`, site OK). Seule conséquence théorique : `debian` devrait
passer par sudo pour éditer ces fichiers à la main — ce qui n'arrive jamais puisqu'ils
viennent de Git. Non corrigé volontairement (ne pas complexifier ce qui marche).

## Automatisation — service + timer systemd

`/etc/systemd/system/deploy-site.service` :
```ini
[Unit]
Description=Deploiement du site mateosan depuis GitHub
After=network-online.target

[Service]
Type=oneshot
User=deploy
ExecStart=/home/deploy/deploy.sh
```

`/etc/systemd/system/deploy-site.timer` :
```ini
[Unit]
Description=Verifie GitHub et deploie le site toutes les 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
```

- `Type=oneshot` : tâche qui s'exécute et se termine.
- `User=deploy` : jamais root.
- `After=network-online.target` : attend le réseau (sinon `git pull` échouerait au boot).

Activation :
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now deploy-site.timer
```

## Méthode de test (important : jamais automatiser sans avoir testé à la main)

1. **Test manuel** du script (`sudo -u deploy /home/deploy/deploy.sh`) AVANT le timer.
   C'est ce qui a révélé les erreurs rsync une par une, en clair, plutôt qu'en silence
   toutes les 2 min sous le timer.
2. **Forcer un vrai déploiement** : `git reset --hard HEAD~1` recule le clone d'un
   commit → le prochain pull a du neuf à ramener → déclenche le rsync.
3. **Vérifier le service sous systemd** (`systemctl status`, `journalctl -u`) : un script
   qui marche à la main peut échouer sous systemd (PATH réduit). Ici : `status=0/SUCCESS`.
4. **Test grandeur nature** : reset du clone, puis NE RIEN FAIRE. Attendre le réveil du
   timer. Vérifier qu'une ligne `deploiement -> ` non déclenchée apparaît dans le journal
   et que la date des fichiers correspond à l'heure du timer.

Preuve finale obtenue :
```
Jul 08 12:53:08 ... deploy.sh: 2026-...T12:53:08 : deploiement 365f001... -> 19f2dfd...
```
(déploiement déclenché par le timer, sans intervention manuelle)

## Commandes de suivi utiles

```bash
systemctl list-timers deploy-site.timer          # prochain déclenchement
systemctl status deploy-site.service             # résultat du dernier run
sudo journalctl -u deploy-site.service -n 20     # logs des déploiements
```

## État final

- [x] Utilisateur `deploy` sans privilèges, sans SSH entrant
- [x] Repo nettoyé : `site/` déployable (3 fichiers autonomes)
- [x] Script `deploy.sh` : pull + détection de changement + rsync
- [x] Timer systemd : vérification toutes les 2 min, pull anonyme (zéro secret)
- [x] Testé à la main puis en conditions réelles (déploiement auto prouvé par les logs)
- [x] Architecture pull : aucune surface d'attaque ajoutée sur le VPS

## Points clés pour un entretien technique

- *« J'ai choisi une architecture pull plutôt que push pour mon déploiement : le
  serveur va chercher les nouveautés, donc aucun accès entrant à ouvrir et le rayon de
  souffle d'un compte GitHub compromis est confiné au repo. »*
- *« J'ai découvert que mon repo contenait l'export brut de l'outil de design et non
  l'artefact déployable — ce qui m'a fait comprendre concrètement pourquoi un pipeline
  sépare le code source de l'artefact de build. »*
- *« Une cascade d'erreurs rsync sur les permissions m'a appris à distinguer traiter le
  symptôme (empiler --no-times, --no-group) de traiter la cause (le processus n'était pas
  propriétaire du dossier cible). »*
- *« Je teste toujours un script à la main, puis sous systemd, avant de l'automatiser —
  l'environnement systemd est plus dépouillé et un script peut y échouer silencieusement. »*

## Reste à faire / améliorations possibles

- Auto-hébergement des Google Fonts (voir `todo-fonts-autohebergement.md`), désormais
  simple commit dans le flux CI/CD.
- Optionnel : re-poser groupe `web` + setgid sur le dossier si `debian` doit éditer à la
  main (dette mineure documentée ci-dessus).
- Évolution vers un « vrai » CI/CD industriel (webhook, tests, build) en phase ultérieure.

## Prochaine étape

Sauvegardes (certifs Caddy, configs `/etc`, données futures) — à faire avant d'ajouter
des services stateful (Phase 5 observabilité).
