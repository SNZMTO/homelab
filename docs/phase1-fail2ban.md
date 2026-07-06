# Phase 1 — Durcissement Linux : fail2ban

> Suite de `phase1-ssh-hardening.md` et `phase1-firewall-ufw.md`. Objectif : compléter le filtrage par port (`ufw`) par une surveillance comportementale — bannir automatiquement les IP qui multiplient les échecs de connexion SSH.

## Contexte

`fail2ban` était déjà installé sur l'image Debian livrée par OVH, avec une jail `sshd` active par défaut :

```bash
sudo fail2ban-client status
# Jail list: sshd
```

---

## 1. Audit de la configuration existante

Même méthode que pour SSH : ne jamais faire confiance à "ça tourne", vérifier la config réellement appliquée.

```bash
cat /etc/fail2ban/jail.d/defaults-debian.conf
```

```ini
[DEFAULT]
banaction = nftables
banaction_allports = nftables[type=allports]
[sshd]
backend = systemd
journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd
enabled = true
```

Points clés :
- Le bannissement passe par **`nftables`**, pas directement par `ufw` — les deux outils agissent sur le pare-feu du noyau par des chemins différents et coexistent sans conflit.
- `fail2ban` lit directement le **journal `systemd`** (pas de fichier `.log` classique), cohérent avec l'absence de `rsyslog` déjà constatée en séance 1.3.

Paramètres de tolérance effectifs, obtenus en interrogeant directement le service (pas en lisant `jail.conf` à l'aveugle, qui contient des dizaines de jails différentes et prête à confusion) :

```bash
sudo fail2ban-client get sshd bantime    # 600 (10 min)
sudo fail2ban-client get sshd findtime   # 600 (10 min)
sudo fail2ban-client get sshd maxretry   # 5
```

**Analyse** : ces valeurs par défaut sont efficaces contre les bots génériques (qui ne reviennent jamais spécifiquement après un bannissement, ils passent simplement à l'IP suivante d'une liste), mais insuffisantes contre un attaquant humain motivé et patient, pour qui 10 minutes d'attente ne représente aucun frein réel.

---

## 2. Durcissement : bannissement progressif

Comme pour SSH, création d'un fichier de configuration dédié plutôt que de modifier les fichiers fournis par le paquet. Pour `fail2ban`, la convention est différente de celle de `sshd_config` : `jail.local` est **toujours lu après** tous les fichiers `.conf`, quel que soit son nom — pas besoin de préfixe numérique.

```bash
sudo nano /etc/fail2ban/jail.local
```

```ini
[sshd]
enabled = true
maxretry = 3
findtime = 1h
bantime = 1h
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1w
```

**Rationale** :
- `maxretry = 3` (au lieu de 5) : resserré sans risque, car SSH n'accepte plus que des clés (séance 1.2) — un utilisateur légitime ne "rate" quasiment jamais une connexion par erreur, il n'y a plus de mot de passe à mal taper.
- `findtime = 1h` (au lieu de 10 min) : élargit la fenêtre d'observation, pour attraper aussi les scans lents et discrets.
- `bantime.increment = true` + `factor = 2` : chaque récidive **double** la durée du bannissement précédent — neutralise spécifiquement les attaquants persistants sans pénaliser excessivement un cas isolé.
- `bantime.maxtime = 1w` : plafond, pour éviter un bannissement permanent sur une base trop ancienne.

```bash
sudo fail2ban-client reload
sudo fail2ban-client get sshd bantime    # 3600
sudo fail2ban-client get sshd maxretry   # 3
```

---

## 3. Découverte critique — bannissement déclaratif, jamais appliqué au réseau

### Test initial

Bannissement manuel d'une IP de test (`192.0.2.1`, plage réservée à la documentation, jamais routée sur Internet) pour valider la chaîne complète sans risquer de s'auto-bannir :

```bash
sudo fail2ban-client set sshd banip 192.0.2.1
sudo fail2ban-client status sshd
```

```
Currently banned: 1
Banned IP list:   192.0.2.1
```

**En apparence, tout fonctionne.** Mais une vérification indépendante était nécessaire : `sudo nft list ruleset` a renvoyé `nft: command not found`.

### Diagnostic

```bash
which nft nftables        # aucune sortie — binaire absent
dpkg -l | grep nftables   # seule libnftnl11 (bibliothèque) présente, pas le paquet nftables
sudo tail -50 /var/log/fail2ban.log
```

Le log de `fail2ban` a révélé la cause exacte :

```
NOTICE  [sshd] Ban 192.0.2.1
ERROR   ... stderr: '/bin/sh: 1: nft: not found'
ERROR   Failed to execute ban jail 'sshd' action 'nftables' ...: 'Script error'
```

**Conclusion** : `fail2ban` décidait bien du bannissement et l'enregistrait dans son état interne (base SQLite, sortie de `fail2ban-client status`), mais la commande shell chargée d'appliquer la règle réseau réelle (`nft add rule ...`) échouait silencieusement, car le paquet `nftables` n'était pas installé sur le système — seule une bibliothèque annexe l'était. **Aucun trafic n'était réellement bloqué.** Un attaquant réel n'aurait jamais été freiné, malgré un outil de contrôle affichant un bannissement "actif".

> Enseignement : ne jamais valider une mesure de sécurité réseau uniquement via l'outil de contrôle qui l'a décidée (`fail2ban-client status`). Vérifier systématiquement l'application réelle au niveau où le trafic est effectivement traité (ici, `nftables`/le noyau).

### Correction

```bash
sudo apt install nftables -y
```

### Validation — preuve réseau réelle

```bash
sudo fail2ban-client set sshd banip 192.0.2.1
sudo nft list ruleset | grep -A 10 f2b
```

```
table inet f2b-table {
    set addr-set-sshd {
        type ipv4_addr
        elements = { 192.0.2.1 }
    }
    chain f2b-chain {
        type filter hook input priority filter - 1; policy accept;
        tcp dport 22 ip saddr @addr-set-sshd reject with icmp port-unreachable
    }
}
```

Cette fois, la règle existe réellement dans la table de filtrage du noyau : toute IP présente dans `addr-set-sshd` se voit rejeter ses connexions vers le port 22. Nettoyage après test :

```bash
sudo fail2ban-client set sshd unbanip 192.0.2.1
```

---

## État final

- [x] `fail2ban` actif avec jail `sshd` durcie (`maxretry=3`, `findtime=1h`, `bantime=1h`)
- [x] Bannissement progressif configuré (doublement à chaque récidive, plafond 1 semaine)
- [x] **Bug critique identifié et corrigé** : paquet `nftables` manquant, bannissements jamais appliqués au réseau
- [x] Bannissement vérifié au niveau noyau (`nft list ruleset`), pas seulement déclaratif

## Points clés pour un entretien technique

- *« ufw et fail2ban se complètent sans se chevaucher : ufw filtre les ports non autorisés en amont, fail2ban surveille le comportement sur les ports qui restent ouverts et bannit dynamiquement via nftables. »*
- *« J'ai découvert que fail2ban rapportait un bannissement réussi côté état interne, alors que la commande réseau échouait silencieusement en arrière-plan faute du paquet nftables — l'outil de contrôle donnait un faux positif de sécurité. »*
- *« Je vérifie systématiquement l'application réelle d'une règle de sécurité réseau au niveau du noyau, pas seulement l'état déclaré par l'outil qui l'a décidée. »*

## Prochaine étape (Phase 1, séance 1.5)

Mises à jour automatiques et hygiène système générale — dernière étape avant la clôture complète de la Phase 1.
