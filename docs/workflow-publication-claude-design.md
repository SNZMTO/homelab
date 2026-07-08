# Workflow de publication — export Claude Design → site en ligne

> Complément à `phase4-cicd-deploiement-auto.md`. Décrit le maillon « humain » entre
> l'outil de design et le pipeline : comment passer d'une modif dans Claude Design à sa
> mise en ligne. Inclut le script `publier.ps1` qui automatise ce maillon côté PC.

## Rappel de la chaîne complète

```
Claude Design (création)
   │  [export manuel — maillon PC, automatisé par publier.ps1]
   ▼
PC Windows (dossier site/ du clone Git)
   │  [git push]
   ▼
GitHub (SNZMTO/homelab)
   │  [pull automatique du VPS toutes les 2 min — Phase 4]
   ▼
Site en ligne (mateosan.fr)
```

Le pipeline (moitié basse, GitHub → site) est automatisé en Phase 4. Ce document
couvre la moitié haute (Claude Design → GitHub), qui reste déclenchée par l'humain
car elle traverse deux environnements qui ne communiquent pas (l'outil de design n'a
pas accès au PC ni aux identifiants Git).

## Structure de l'export Claude Design (piège important)

Le zip exporté contient PLUSIEURS versions des fichiers. Il faut prendre la bonne :

| Emplacement dans le zip | Contenu | Utilisable ? |
|---|---|---|
| racine (`Etabli.dc.html` + js) | format éditeur (`<sc-if>`, `{{...}}`) | ❌ non déployable |
| `export/Etabli-standalone.dc.html` | bundle inliné (blob URLs) | ❌ cassé en HTTPS |
| **`export/web/`** (`index.html` + 2 js) | **multi-fichiers hébergeable** | ✅ **c'est celui-ci** |

→ La source déployable est **`export/web/`**, et le HTML y est déjà nommé `index.html`
(pas besoin de renommer). Tout le reste (`screenshots/`, `uploads/`, `.thumbnail`, les
autres HTML) est du superflu à ignorer.

## Le site : 3 fichiers autonomes

`index.html`, `etabli-scene.js`, `support.js`. La scène 3D est générée en pur code
Three.js, sans textures ni images externes → ces 3 fichiers suffisent, rien d'autre à
copier.

## Piège vécu — l'export doit contenir la vraie version

Symptôme rencontré : après copie des fichiers, `git status` disait `nothing to commit`
alors que des modifs étaient attendues. Cause : les premiers zips exportés ne
contenaient PAS les modifs (version figée / antérieure). Git compare le *contenu*
(pas la taille), donc il est le juge de vérité : tant qu'il dit `nothing to commit`,
c'est que l'export ne porte pas les changements. Résolu en re-exportant depuis Claude
Design jusqu'à obtenir un zip dont le contenu diffère (Git affiche alors `modified:`).

→ Règle : ne jamais supposer qu'un export contient les modifs. Laisser `git status`
confirmer avant de publier.

## Publication manuelle (les commandes de base)

```powershell
cd C:\Users\Sczma\Documents
Remove-Item .\claude-export -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path ".\Établi 3D homelab interactif.zip" -DestinationPath ".\claude-export" -Force

Copy-Item .\claude-export\export\web\index.html       C:\Users\Sczma\Desktop\homelab\site\ -Force
Copy-Item .\claude-export\export\web\etabli-scene.js   C:\Users\Sczma\Desktop\homelab\site\ -Force
Copy-Item .\claude-export\export\web\support.js        C:\Users\Sczma\Desktop\homelab\site\ -Force

cd C:\Users\Sczma\Desktop\homelab
git status                        # doit montrer "modified:" si la modif est reelle
git add site/
git commit -m "feat: mise a jour du site"
git push
```

Puis le VPS déploie seul dans les 2 min. Vérifier avec `Ctrl+F5` sur mateosan.fr.

## Automatisation — script publier.ps1

Placé à la racine du dépôt (`C:\Users\Sczma\Desktop\homelab\publier.ps1`), il condense
tout le cycle en une commande : `.\publier.ps1`.

Ce qu'il fait, avec garde-fous (esprit `deploy.sh`) :
1. Trouve automatiquement le zip le plus récent dans `Documents`.
2. Nettoie l'extraction précédente puis ré-extrait.
3. **Vérifie que `export/web/` existe** (sinon mauvais zip → stop).
4. Copie les 3 fichiers vers `site/`.
5. **Ne commit QUE s'il y a un changement réel** (`git status --porcelain`) → pas de
   commit vide si rien n'a bougé.
6. Commit + push avec horodatage.

## Réglages Windows nécessaires (une fois)

Les scripts PowerShell sont bloqués par défaut. Séquence pour autoriser SES propres
scripts sans ouvrir la porte aux scripts random d'Internet :

```powershell
# 1. Autoriser les scripts locaux (une fois par utilisateur)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# 2. Retirer l'etiquette "venu d'Internet" du script telecharge (une fois par fichier)
Unblock-File -Path .\publier.ps1
```

- `RemoteSigned` : autorise les scripts écrits localement, exige une signature pour
  ceux téléchargés → bon équilibre sécurité/praticité.
- `Unblock-File` : retire le *Mark of the Web* (l'étiquette invisible mise sur tout
  fichier téléchargé). Nécessaire car le script a été récupéré depuis un chat.
- ⚠️ Lancer les `.ps1` depuis une fenêtre PowerShell **déjà ouverte**, pas en
  double-cliquant (sinon la fenêtre se ferme trop vite pour voir la sortie/les erreurs).

## Usage courant (une fois tout configuré)

```powershell
# 1. Modifier le site dans Claude Design, exporter le zip dans Documents
# 2. Puis :
cd C:\Users\Sczma\Desktop\homelab
.\publier.ps1
# 3. Attendre 2 min, verifier mateosan.fr (Ctrl+F5)
```

## État final

- [x] Structure d'export Claude Design comprise (`export/web/` = source déployable)
- [x] Workflow manuel de publication maîtrisé et documenté
- [x] Script `publier.ps1` opérationnel (auto-détection du zip, garde-fous, commit conditionnel)
- [x] Réglages PowerShell en place (RemoteSigned + Unblock-File)
- [x] Premier déploiement d'une vraie mise à jour de contenu réussi de bout en bout

## Améliorations possibles

- Raccourci double-cliquable sur le bureau (lançant PowerShell + le script en gardant
  la fenêtre ouverte).
- À terme : si Claude Design permettait de pousser sur Git, une GitHub Action ferait le
  « build » (extraction `export/web/`) côté serveur — vrai CI/CD industriel.
