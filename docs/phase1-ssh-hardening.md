# Phase 1 — Durcissement Linux : Accès SSH

> Journal technique du homelab. Objectif de cette partie : sécuriser l'accès distant au VPS avant toute mise en production de services.

## Contexte

- **Hébergeur** : OVH VPS
- **OS** : Debian 13 (trixie), noyau `6.12.86+deb13-amd64`
- **Utilisateurs système** : `root` (désactivé en SSH), `debian` (compte d'administration avec `sudo`)

---

## 1. Audit de la configuration initiale

Avant toute modification, audit de l'état livré par OVH :

```bash
cat /etc/os-release                                    # identification de l'OS
sudo whoami                                             # vérification des droits sudo
grep -E '/bin/(ba)?sh$' /etc/passwd                     # liste des comptes avec shell
sudo grep -i "^PermitRootLogin\|^PasswordAuthentication" /etc/ssh/sshd_config
```

### Constat n°1 — Connexion root déjà restreinte côté OVH

La connexion `root@IP` échoue dès la livraison (y compris depuis la console KVM du Manager OVH). L'accès initial se fait via un compte non-privilégié `debian`, avec droits `sudo` déjà configurés. OVH applique donc par défaut un principe de moindre privilège partiel.

### Constat n°2 — Contradiction dans la configuration SSH

Le fichier principal `/etc/ssh/sshd_config` affichait `PasswordAuthentication no`, mais l'authentification par mot de passe fonctionnait malgré tout à la connexion.

**Cause identifiée :**

```bash
sudo grep -i "^Include" /etc/ssh/sshd_config
# → Include /etc/ssh/sshd_config.d/*.conf

sudo grep -ril "PermitRootLogin\|PasswordAuthentication" /etc/ssh/sshd_config.d/
# → /etc/ssh/sshd_config.d/50-cloud-init.conf
```

`sshd_config` inclut tous les fichiers `.conf` du dossier `sshd_config.d/`. **Ces fichiers inclus sont lus avant le corps du fichier principal et la première valeur rencontrée fait foi** — d'où l'importance du préfixe numérique dans le nom de fichier (ordre alphabétique de lecture). Le fichier `50-cloud-init.conf`, généré automatiquement par `cloud-init` au premier démarrage, définissait :

```
PasswordAuthentication yes
```

Ce fichier prenait donc le dessus sur la configuration par défaut, plus stricte, du fichier principal.

**Enseignement** : ne jamais auditer un seul fichier de configuration SSH sans vérifier les directives `Include`. Un système peut sembler durci "sur le papier" sans l'être réellement.

---

## 2. Mise en place de l'authentification par clé (Ed25519)

### Étapes suivies

1. Génération de la paire de clés côté client (Windows, déjà réalisée en amont) : `id_ed25519` (privée) / `id_ed25519.pub` (publique).
2. Dépôt de la clé publique sur le serveur, dans le compte `debian` :

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "ssh-ed25519 AAAA... homelab-vps" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Les permissions `700` (dossier) et `600` (fichier) sont strictement exigées par `sshd` : au-delà de ces droits, il ignore silencieusement les clés du dossier par mesure de sécurité.

3. **Validation de la connexion par clé avant toute désactivation du mot de passe** (session parallèle, sans fermer l'accès existant) :

```bash
ssh -i ~/.ssh/id_ed25519 debian@IP_VPS
```

→ Connexion réussie sans prompt de mot de passe.

### Pourquoi une clé plutôt qu'un mot de passe

- Un mot de passe est vulnérable au brute-force (essais automatisés en masse par des bots qui scannent Internet en continu).
- Une clé Ed25519 repose sur un défi cryptographique : la clé privée ne transite jamais sur le réseau, et l'espace de recherche (256 bits) rend le brute-force mathématiquement infaisable.

---

## 3. Durcissement final : fichier de configuration dédié

Plutôt que de modifier `50-cloud-init.conf` (risque d'écrasement si `cloud-init` régénère ses fichiers), création d'un fichier de configuration propre au projet, avec un préfixe numérique inférieur pour garantir sa priorité de lecture :

**`/etc/ssh/sshd_config.d/10-hardening.conf`**
```
PermitRootLogin no
PasswordAuthentication no
```

### Procédure de déploiement sécurisée

```bash
sudo sshd -t                                             # validation syntaxique AVANT tout redémarrage
sudo sshd -T | grep -E "permitrootlogin|passwordauthentication"   # vérification de la config effective fusionnée
sudo systemctl restart sshd                              # application (ne coupe pas les sessions déjà ouvertes)
```

**Méthode appliquée** : au moins deux sessions SSH actives maintenues ouvertes pendant toute la manipulation, pour garantir un accès de secours en cas d'erreur de configuration — avant de valider dans une session distincte.

### Vérifications post-déploiement

| Test | Commande | Résultat attendu | Résultat obtenu |
|---|---|---|---|
| Mot de passe refusé | `ssh -o PubkeyAuthentication=no debian@IP_VPS` | `Permission denied (publickey)` | ✅ |
| Connexion par clé (debian) | `ssh debian@IP_VPS` | Connexion directe, sans prompt | ✅ |
| Root bloqué même avec clé | `ssh root@IP_VPS` | `Permission denied (publickey)` | ✅ |

---

## État final de la sécurité SSH

- [x] Authentification par mot de passe désactivée globalement
- [x] Connexion `root` interdite en SSH, quelle que soit la méthode
- [x] Seule l'authentification par clé Ed25519 est acceptée
- [x] Configuration versionnée dans un fichier dédié, indépendant de `cloud-init`

## Points clés pour un entretien technique

- *« J'ai audité la configuration SSH héritée de cloud-init et découvert qu'un fichier d'override réactivait l'authentification par mot de passe malgré une configuration principale plus stricte — j'ai créé un fichier de durcissement dédié avec une priorité de lecture plus élevée. »*
- *« L'authentification par clé élimine la surface d'attaque du brute-force : la clé privée ne quitte jamais le poste client, et l'espace de clés est cryptographiquement infaisable à explorer. »*
- *« Je n'utilise jamais root au quotidien : chaque compte n'a que les droits strictement nécessaires (principe du moindre privilège), et root est totalement inaccessible en SSH. »*

## Prochaine étape (Phase 1, séance 1.3)

Mise en place d'un pare-feu (`ufw`) pour ne laisser passer que le strict trafic nécessaire (SSH, puis HTTP/HTTPS quand un reverse proxy sera en place).
