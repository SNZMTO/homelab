# Le serveur de mateosan.fr : le Caddy du frontal, sans la capacité d'écouter sous le port 1024 (il écoute sur 8080), pour tourner
# sans être root et sans aucune capacité. Construit par deploiement/mettre-en-ligne.sh.
FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
RUN setcap -r /usr/bin/caddy
USER 65534:65534
