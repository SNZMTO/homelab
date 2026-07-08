# TODO — Auto-héberger les Google Fonts (à faire dans Claude Design)

**Statut :** en attente. Non bloquant. Amélioration RGPD/confidentialité, pas une faille.

## Contexte

Le site charge actuellement 3 familles Google Fonts en direct depuis les serveurs
de Google (`fonts.googleapis.com` + `fonts.gstatic.com`), via ces lignes dans le
`<head>` de l'export :

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&family=Caveat:wght@500;600&display=swap" rel="stylesheet">
```

## Pourquoi le faire

- **RGPD / vie privée** : chaque visiteur transmet son IP à Google. Des jugements
  européens (notamment en Allemagne) ont sanctionné ce chargement direct sans
  consentement. Sensible pour un portfolio hébergé en France.
- **Reproductibilité** : une police auto-hébergée ne change jamais sous les pieds.
- **Autonomie** : plus de dépendance à un tiers pour l'affichage.

## Poids exacts à conserver (ne pas en oublier)

| Famille | Graisses utilisées |
|---|---|
| Fredoka | 400, 500, 600, 700 |
| Nunito  | 400, 600, 700, 800 |
| Caveat  | 500, 600 |

## Le point de blocage / où le faire

La source de vérité du site est **Claude Design**, PAS les fichiers dans
`/opt/mateosan/site/` sur le VPS (qui sont un export généré, avec balises
`<helmet>`, `<sc-if>`, `<sc-for>`, `{{...}}`).

⚠️ **Ne PAS éditer les fichiers sur le VPS** : au prochain export Claude Design,
les liens Google Fonts reviendraient et la modif serveur serait écrasée.

→ L'auto-hébergement doit se faire **dans Claude Design** (lui demander d'héberger
les polices localement dans l'export). À vérifier : selon l'export, Claude Design
permet ou non d'injecter des `.woff2` locaux + un `@font-face` custom.

## Méthode manuelle de secours (si Claude Design ne le permet pas)

1. Récupérer les `.woff2` des poids ci-dessus via **google-webfonts-helper**
   (gwfh.mranftl.com) — sélectionner exactement ces graisses, format woff2 moderne.
2. Placer les fichiers dans un dossier `fonts/` du site.
3. Écrire un CSS `@font-face` par famille/graisse, avec `font-display: swap`.
4. Retirer les 3 `<link>` Google du `<head>` et les `preconnect`.

## Note technique — font-display

`font-display: swap` = le texte s'affiche immédiatement dans une police de repli,
puis bascule sur la vraie police une fois chargée (pas de texte invisible au
chargement). C'est le bon choix pour un portfolio : le contenu est lisible tout
de suite. (`optional` masquerait la bascule mais risque de ne jamais charger la
vraie police sur connexion lente — moins adapté ici.)

## Quand le faire

Après la mise en place du **CI/CD** (push → déploiement auto). Une fois la
tuyauterie en place, poser les fonts (si faisable dans Claude Design) devient un
simple commit dans le flux normal.
