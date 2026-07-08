# Phases 2 & 3 — Conteneurisation & mise en ligne du portfolio (Docker + Caddy + HTTPS)

> Transition Phase 1 → Phases 2/3, anticipée pour un besoin concret : mettre en ligne le site vitrine `mateosan.fr` sur le VPS durci. Couvre l'installation de Docker, la configuration DNS, l'ouverture du pare-feu, le déploiement via Caddy et l'obtention automatique du certificat HTTPS.

## Contexte

- **Machine** : VPS OVH, Debian 13 (trixie). Utilisateur `debian` (sudo). Connexion depuis Windows/PowerShell.
- **Point de départ** : Phase 1 faite (SSH par clé, ufw deny-by-default, fail2ban). Aucun serveur web, pas de Docker.
- **Objectif** : héberger le portfolio (site 3D "établi") sur `https://mateosan.fr`.
- **Décision d'architecture** : hébergement sur le **VPS** (IP publique fixe), et non sur une machine derrière une box. Écarte tout le volet CGNAT / redirection de ports routeur.

---

## 1. Installation de Docker

Méthode via le script officiel (`get.docker.com`), avec vérification du contenu avant exécution (réflexe : ne jamais exécuter un script téléchargé sans le lire) :

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
head -20 get-docker.sh        # vérif : bien le script officiel Docker
sudo sh get-docker.sh
```

Résultat : Docker Engine + CLI + Compose installés, daemon activé au boot. Version serveur et client répondent.

> Note : le script lui-même indique « not recommended for production ». Acceptable pour un homelab ; à remplacer par une install via dépôt APT avec versions figées lors de l'industrialisation (Phase 6 / Ansible).

### Confort d'usage — groupe docker

```bash
sudo docker run --rm hello-world      # validation bout-en-bout
sudo usermod -aG docker debian        # évite sudo devant chaque commande docker
# déconnexion / reconnexion SSH pour recharger les groupes
docker ps                             # OK sans sudo
```

> **Point de sécurité important** : appartenir au groupe `docker` équivaut à un accès root sur l'hôte (le daemon peut monter le système de fichiers hôte). C'est une entorse assumée au moindre privilège, acceptable ici car `debian` est déjà le compte admin. Le mode *rootless* existe pour les environnements sensibles.

---

## 2. DNS (OVH)

Domaine `mateosan.fr` géré chez OVH (même compte que le VPS). État initial : deux enregistrements `A` (`@` et `www`) pointaient vers l'IP de **parking OVH** (`213.186.33.5`).

**Modification** (et non suppression/recréation, pour éviter deux A contradictoires transitoires) :
- `@` type `A` → IP du VPS
- `www` type `A` → IP du VPS

Enregistrements NS / SPF / TXT / MX / CNAME `ftp` laissés intacts (gestion du domaine et de la messagerie).

**Vérification de propagation** depuis le serveur :
```bash
getent hosts mateosan.fr      # doit renvoyer l'IP du VPS
```

> Le DNS est fait en premier car la propagation prend du temps, et l'obtention du certificat HTTPS échouerait tant que le domaine ne pointe pas vers le serveur.

---

## 3. Ouverture du pare-feu (ufw)

Un serveur web a besoin des ports 80 et 443 :

```bash
sudo ufw allow 80/tcp comment 'HTTP - Caddy'
sudo ufw allow 443/tcp comment 'HTTPS - Caddy'
sudo ufw status verbose
```

- Port 80 : nécessaire au challenge ACME de Let's Encrypt + redirection HTTP→HTTPS.
- Port 443 : trafic web chiffré.
- `comment` : documente la raison de chaque règle (lisible plus tard dans `ufw status`).

---

## 4. Déploiement du site (Caddy + Docker Compose)

### Arborescence

```bash
sudo mkdir -p /opt/mateosan/site
sudo chown -R debian:debian /opt/mateosan
```

`/opt/` = emplacement standard pour une application déployée manuellement. Transfert des fichiers du site depuis le PC via `scp` (fonctionne sans mot de passe grâce à l'auth par clé) :

```powershell
scp index.html support.js etabli-scene.js debian@IP_VPS:/opt/mateosan/site/
```

### Caddyfile

`/opt/mateosan/Caddyfile` :
```
mateosan.fr, www.mateosan.fr {
	root * /srv
	file_server
	encode gzip
}
```

Le simple fait d'indiquer un vrai nom de domaine déclenche l'obtention automatique du certificat HTTPS.

> **Piège rencontré** : coller le Caddyfile depuis l'interface de chat transformait `www.mateosan.fr` en lien Markdown `[...](...)`. Réflexe : relire le fichier après collage (`cat -A` révèle les caractères parasites). Corrigé via `cat > fichier << 'EOF'` (écriture directe, sans interprétation).

### docker-compose.yml

`/opt/mateosan/docker-compose.yml` :
```yaml
services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./site:/srv:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

Points clés :
- `restart: unless-stopped` : le site remonte seul après un reboot (indispensable, notamment pour le reboot auto de la séance 1.5).
- `./site:/srv:ro` : lie le dossier local au `root` du Caddyfile, en lecture seule.
- `caddy_data:/data` : **persiste les certificats HTTPS**. Sans ce volume, perte du certificat à chaque redémarrage → risque de rate-limit Let's Encrypt.

### Lancement

```bash
cd /opt/mateosan
docker compose up -d
docker compose logs -f caddy
```

Logs observés : challenge ACME `http-01` résolu, **validation multi-perspective** (Let's Encrypt vérifie depuis plusieurs points du globe simultanément), puis `certificate obtained successfully` pour les deux domaines. Site en ligne en HTTPS en ~6 secondes, sans manipulation manuelle de certificat.

---

## 5. Le feuilleton du format de fichier (enseignement majeur)

Le site (scène 3D Three.js) a d'abord été livré par Claude Design en **bundle "standalone"** : un unique HTML de 930 Ko où tout le JS était inliné et reconstruit au runtime via **blob URLs + import dynamique**.

- **Symptôme** : la page se chargeait, mais la scène 3D échouait une fois servie en HTTPS (« la scène 3D n'a pas pu se charger »), alors qu'elle fonctionnait en ouverture locale (`file://`).
- **Cause** : le mécanisme blob/import du bundle est bloqué par les règles de sécurité du navigateur sur une origine `https://`. Ce format est fait pour la **prévisualisation**, pas pour l'hébergement.
- **Vérification** : comparaison md5 → la v1 et la v2 « corrigée » étaient **identiques**. Le bundle standalone n'était donc pas régénéré, et n'était de toute façon pas le bon artefact.
- **Solution** : export **multi-fichiers hébergeable** (`index.html` + `support.js` + `etabli-scene.js`, chargés normalement en `<script src>` / fetch même-origine). Déployé tel quel, la scène 3D fonctionne en HTTPS.

> Enseignement : distinguer un artefact de **prévisualisation** d'un artefact **déployable**. Un fichier « qui marche en local » ne marche pas forcément servi par un serveur web (contraintes d'origine/CORS/blob).

### Diagnostic WebGL (faux bug)

Après déploiement de la bonne version, la scène échouait dans **Firefox** (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`). Diagnostic : problème **local** au poste (couche ANGLE / pilote GPU), pas au site — confirmé car `get.webgl.org` échouait aussi. Le site fonctionnait dans Chrome/Edge.

> Enseignement : isoler « bug du site » vs « bug de l'environnement client » avant de corriger. La console navigateur (F12) donne la cause, pas seulement le symptôme.

### Robustesse ajoutée (dégradation gracieuse)

Corrections demandées à Claude Design suite à ce constat :
- Détection d'échec WebGL → message d'erreur stylisé.
- **Menu de navigation de secours** affiché si la 3D échoue, pour que le site reste 100 % navigable sans WebGL.

---

## Dépendances externes (à noter)

Three.js, React et Babel sont chargés depuis des **CDN publics** (cdnjs / unpkg) en HTTPS. Fonctionne tant que le visiteur a accès à Internet (cas normal). Une version 100 % auto-hébergée (sans CDN) est possible si zéro dépendance externe devient un objectif.

---

## État final

- [x] Docker installé, `debian` dans le groupe docker
- [x] DNS `mateosan.fr` + `www` → VPS (OVH)
- [x] ufw : 80/443 ouverts (en plus de SSH)
- [x] Site servi par un conteneur Caddy (docker-compose dans `/opt/mateosan/`)
- [x] HTTPS automatique via Let's Encrypt (challenge ACME http-01), certificats persistés
- [x] Site en ligne et fonctionnel sur https://mateosan.fr (format multi-fichiers hébergeable)
- [x] Dégradation gracieuse si WebGL indisponible (message + menu de secours)

## Points clés pour un entretien technique

- *« J'ai déployé mon portfolio en conteneur Docker derrière un reverse proxy Caddy, qui obtient et renouvelle automatiquement les certificats TLS via le challenge ACME de Let's Encrypt — zéro gestion manuelle de crypto. »*
- *« J'ai conscience que l'accès au socket Docker équivaut à un accès root sur l'hôte — d'où un contrôle strict de l'appartenance au groupe docker. »*
- *« J'ai distingué un artefact de prévisualisation (bundle inliné, blob/import bloqués en https) d'un artefact déployable multi-fichiers — et vérifié via md5 que la "correction" livrée était en fait identique. »*
- *« J'ai prévu une dégradation gracieuse : si WebGL n'est pas disponible chez le visiteur, la navigation reste entièrement fonctionnelle via un menu de secours. »*

## Prochaines étapes

- Itérations restantes sur la scène 3D (animations, gyroscope mobile, performances).
- Option : auto-héberger Three.js/React (supprimer la dépendance CDN).
- Suite de la roadmap : CI/CD (Phase 4) pour automatiser le déploiement du site via GitHub Actions, puis observabilité (Phase 5).
