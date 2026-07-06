# Phase 1 — Durcissement Linux : Pare-feu (ufw)

> Suite de `phase1-ssh-hardening.md`. Objectif : passer d'un serveur où tout port ouvert par un service est directement joignable depuis Internet, à une politique stricte "tout refuser en entrée, sauf exception explicite".

## Contexte

Avant cette séance, aucun pare-feu n'était installé sur le VPS (image Debian nue livrée par OVH) :

```bash
sudo ufw status
# → sudo: ufw: command not found
```

---

## 1. Installation

```bash
sudo apt update && sudo apt install ufw -y
```

**Note en passant** : l'installation a signalé `64 packages can be upgraded` — traité volontairement en séance 1.5 (mises à jour), pour ne pas mélanger les sujets dans cette session.

`ufw` s'installe comme service `systemd` mais reste inactif tant qu'il n'est pas explicitement activé (`ufw enable`) — étape volontairement retardée à la toute fin, une fois les règles nécessaires posées.

---

## 2. Politique par défaut

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

**Rationale** :
- **Entrant refusé par défaut** : tout trafic entrant est une connexion initiée par un tiers non sollicité. C'est la surface d'attaque (scans, bots, tentatives d'intrusion).
- **Sortant autorisé par défaut** : le trafic sortant est initié volontairement par le serveur lui-même (mises à jour système, résolution DNS, appels vers des services externes). Le risque est maîtrisé car contrôlé par ce qui tourne sur la machine.

*Nuance à garder en tête pour une infra plus sensible* : un sortant totalement libre n'est pas un risque nul (exfiltration de données en cas de compromission). Pour ce projet, `allow outgoing` reste un choix pragmatique standard.

---

## 3. Autorisation explicite de SSH — avant activation

**Règle appliquée** : ne jamais activer un pare-feu en `deny incoming` par défaut sans avoir d'abord autorisé explicitement le port utilisé pour l'administration (SSH) — sous peine de couper son propre accès distant, sans recours autre que la console KVM du fournisseur.

```bash
sudo ufw app list        # catalogue des profils disponibles (aucun n'est actif tant qu'il n'est pas "allow")
sudo ufw allow OpenSSH   # autorise explicitement le profil SSH
sudo ufw show added      # vérifie la règle AVANT activation, sans risque
```

Résultat confirmé avant activation :
```
Added user rules (see 'ufw status' for running firewall):
ufw allow OpenSSH
```

---

## 4. Activation

```bash
sudo ufw enable
sudo ufw status verbose
```

Résultat :
```
Status: active
Default: deny (incoming), allow (outgoing), disabled (routed)
22/tcp (OpenSSH)      ALLOW IN  Anywhere
22/tcp (OpenSSH (v6)) ALLOW IN  Anywhere (v6)
```

SSH reste ouvert depuis n'importe quelle IP source (`Anywhere`) — volontairement large à ce stade, car l'IP cliente personnelle n'est pas fixe. Compensation prévue en séance 1.4 (`fail2ban`) pour bannir automatiquement les IP abusives plutôt que de restreindre une plage fixe.

**Validation post-activation** : connexion SSH testée avec succès depuis une nouvelle session, sans interruption des sessions déjà ouvertes.

---

## 5. Vérification en conditions réelles

Test volontaire d'un port sans règle d'autorisation (8080, aucun service ne l'utilise) :

```powershell
Test-NetConnection -ComputerName IP_VPS -Port 8080
# → TcpTestSucceeded : False
```

Confirmation côté serveur, via le journal noyau (`journalctl`, puisque `rsyslog` n'est pas installé et qu'aucun fichier `/var/log/ufw.log` n'existe sur cette image) :

```bash
sudo journalctl -k -f
```

```
[UFW BLOCK] IN=ens3 ... SRC=<IP_client> DST=<IP_VPS> ... DPT=8080 ... SYN
```

### Découverte annexe — persistance du journal

Une première tentative de recherche a posteriori (`journalctl -k | grep "DPT=8080"`) n'a rien renvoyé, alors que la ligne existait bien quelques minutes plus tôt. Cause identifiée : le journal `systemd` de cette machine fonctionne en mode volatile (non persistant sur disque) et son buffer est rapidement écrasé par le volume de bruit de fond réseau (voir section suivante). Un nouveau test **synchronisé** (observation en direct pendant le déclenchement) a confirmé le blocage sans ambiguïté.

**Piste d'amélioration notée pour la Phase 5 (observabilité)** : activer la persistance du journal (`Storage=persistent` dans `journald.conf`) ou envisager un outil de log dédié si une analyse a posteriori des tentatives d'intrusion devient nécessaire.

### Découverte annexe — ping (ICMP) non bloqué

Le ping vers le serveur fonctionne malgré `deny incoming`, alors que TCP sur un port non autorisé est bloqué. Explication : ICMP (ping) est traité par des règles distinctes dans `ufw` (fichier `before.rules`), en amont de la politique par défaut appliquée aux ports TCP/UDP. Le ping ne cible aucun service ni port précis — il ne représente donc pas la même surface d'exposition qu'une connexion TCP vers un port ouvert.

---

## 6. Bruit de fond observé (le fameux "background radiation" d'Internet)

Dès les toutes premières minutes suivant l'activation du pare-feu, des dizaines de tentatives de connexion non sollicitées ont été bloquées et journalisées, provenant d'IP variées à travers le monde. Ports les plus ciblés observés :

| Port ciblé | Signification probable |
|---|---|
| 23 / 2323 | Telnet — signature classique de botnets type Mirai scannant des objets connectés mal sécurisés |
| 25565 | Port par défaut Minecraft — recherche de serveurs de jeu mal protégés |
| 110 | POP3 — recherche de vieux services mail mal configurés |
| Protocole GRE (47) | Souvent lié à des tentatives ciblant des VPN mal sécurisés |

**Enseignement** : ce trafic n'est pas une attaque ciblée contre ce serveur en particulier — c'est le scan permanent et automatisé qui touche toute IP publique dès sa mise en ligne, qu'elle héberge quelque chose d'intéressant ou non. Preuve concrète, en conditions réelles, que la politique *deny by default* n'est pas une précaution théorique.

---

## État final

- [x] `ufw` installé et actif au démarrage du système
- [x] Politique par défaut : *deny incoming*, *allow outgoing*
- [x] SSH (IPv4 + IPv6) explicitement autorisé, seule porte d'entrée ouverte
- [x] Blocage vérifié en conditions réelles (port de test + logs noyau)
- [x] Comportement du ping (ICMP) compris et distingué du filtrage TCP/UDP

## Points clés pour un entretien technique

- *« J'applique une politique deny-by-default sur le pare-feu, avec uniquement SSH autorisé en entrée — j'ai vérifié ce comportement en conditions réelles plutôt que de me fier à la configuration affichée. »*
- *« Dès la mise en ligne du serveur, j'ai pu observer le bruit de scan permanent d'Internet (Telnet, ports de jeu, GRE) dans les logs — une preuve concrète que même un serveur "sans rien dessus" est une cible en continu. »*
- *« J'ai identifié que le journal systemd de cette machine n'est pas persistant, ce qui a nécessité une observation synchronisée pour valider certains blocages — point noté comme amélioration future pour l'observabilité. »*

## Prochaine étape (Phase 1, séance 1.4)

Mise en place de `fail2ban` pour bannir automatiquement les IP qui multiplient les tentatives de connexion SSH échouées, en complément du pare-feu qui filtre par port mais pas par comportement.
