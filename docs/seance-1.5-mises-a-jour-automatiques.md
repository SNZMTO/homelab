# Séance 1.5 — Mises à jour automatiques (clôture Phase 1)

**Objectif :** faire en sorte que le serveur applique tout seul les correctifs de
sécurité, pour que le durcissement des séances 1.1→1.4 ne repose pas sur un système
qui pourrit avec des failles connues. Porte blindée sur un mur en carton = inutile.

**Machine :** VPS OVH, Debian 13 (trixie), noyau `6.12.86+deb13-amd64`.
**Utilisateur :** `debian` (sudo). Connexion depuis Windows/PowerShell.

---

## Principe

- **Durcir** = réduire la surface d'attaque (séances 1.1→1.4).
- **Mettre à jour** = réparer les trous qui apparaissent dans la surface restante.
Les deux sont indissociables. C'est l'objet de cette séance.

Outil : `unattended-upgrades` (déjà présent sur Debian 13, v2.12), déclenché
quotidiennement par `apt-daily-upgrade.timer` (systemd).

## Décisions prises

| Décision | Choix retenu | Raison |
|---|---|---|
| Périmètre | **Sécurité seulement** | Les paquets `Debian-Security` sont des rétroportages minimaux du correctif : risque de casse quasi nul. Le reste (bugfix, montées de version) reste appliqué à la main, quand je suis devant. |
| Reboot auto | **Activé, 04:00** | Le noyau / la libc ne prennent effet qu'après reboot. Condition bloquante vérifiée : le conteneur Caddy a `restart: unless-stopped`, donc le site remonte seul au boot. |
| Docker / trixie-updates | **Exclus de l'auto** | Confirmé par le dry-run (pin -32768). Je garde la main sur le moteur de conteneurs pour éviter qu'une MàJ nocturne casse le site. |

## État constaté avant modification (on regarde avant de toucher)

`/etc/apt/apt.conf.d/20auto-upgrades` — moteur déjà actif :
```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

`/etc/apt/apt.conf.d/50unattended-upgrades` — origins de sécurité déjà décommentés
par défaut (aucune modif nécessaire côté périmètre) :
```
Unattended-Upgrade::Origins-Pattern {
        "origin=Debian,codename=${distro_codename},label=Debian";
        "origin=Debian,codename=${distro_codename},label=Debian-Security";
        "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};
```

## Modification appliquée

Fichier de **surcharge dédié** `/etc/apt/apt.conf.d/52unattended-upgrades-local`
(prioritaire sur le `50`, survit aux mises à jour du paquet — plus propre que
d'éditer le fichier livré par Debian) :

```conf
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
```

- `Automatic-Reboot "true"` : autorise le reboot après une MàJ qui l'exige.
- `WithUsers "true"` : reboote même si une session (la mienne) est ouverte, sinon
  un reboot nécessaire pourrait être repoussé indéfiniment.
- `Automatic-Reboot-Time "04:00"` : heure serveur (UTC).

Commande utilisée :
```bash
sudo tee /etc/apt/apt.conf.d/52unattended-upgrades-local > /dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
```

## Vérification (dry-run, aucune installation réelle)

```bash
sudo unattended-upgrade --dry-run --debug 2>&1 | tail -n 30
```

Résultats clés :
- **Allowed origins** : `label=Debian`, `label=Debian-Security`, `trixie-security` → OK.
- **Marking not allowed** (pin -32768) sur : Docker CE, trixie-backports,
  trixie-updates → **exclus de l'auto comme voulu**.
- `No packages found that can be upgraded... upgrade result: True` → système déjà à
  jour, mécanisme fonctionnel de bout en bout.

Contrôle des timers :
```bash
systemctl is-enabled apt-daily.timer apt-daily-upgrade.timer   # attendu : enabled x2
```

## Notes / pièges

- Warnings `powermgmt-base` et `python3-gi` manquants : détection batterie / connexion
  facturée. **Inutiles sur un VPS**, ignorés volontairement.
- `0 B fetched` = rien à télécharger aujourd'hui, **pas** une erreur.
- Le reboot auto n'est acceptable QUE parce que `restart: unless-stopped` est présent
  dans `/opt/mateosan/docker-compose.yml`. Si cette politique change, réévaluer le reboot auto.

## Résultat

**Phase 1 (durcissement) terminée.** Le serveur :
- n'accepte le SSH que par clé Ed25519, root SSH bloqué (1.2) ;
- filtre tout sauf SSH/80/443 via ufw (1.3) ;
- bannit les tentatives répétées via fail2ban + nftables (1.4) ;
- **applique seul les correctifs de sécurité et reboote à 04:00 si nécessaire (1.5)**,
  le portfolio remontant automatiquement grâce à `restart: unless-stopped`.

**Prochaine étape :** documenter la session Docker / déploiement / HTTPS (Caddy +
Let's Encrypt) dans `docs/`, pas encore tracée.
