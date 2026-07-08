# publier.ps1
# Automatise la publication du site : extrait le dernier export Claude Design,
# copie les 3 fichiers dans site/, commit et push si quelque chose a change.
# Le pipeline sur le VPS deploie ensuite tout seul.

# --- S'arreter a la premiere erreur (equivalent de 'set -e' en bash) ---
$ErrorActionPreference = "Stop"

# --- Chemins (a adapter si ton arborescence change) ---
$Documents = "C:\Users\Sczma\Documents"
$RepoSite  = "C:\Users\Sczma\Desktop\homelab\site"
$RepoRoot  = "C:\Users\Sczma\Desktop\homelab"
$Extract   = Join-Path $Documents "claude-export"

Write-Host "=== Publication du site ===" -ForegroundColor Cyan

# --- 1. Trouver le zip le plus recent dans Documents ---
$zip = Get-ChildItem -Path $Documents -Filter *.zip |
       Sort-Object LastWriteTime -Descending |
       Select-Object -First 1

if ($null -eq $zip) {
    Write-Host "Aucun zip trouve dans $Documents. Abandon." -ForegroundColor Red
    exit 1
}
Write-Host "Zip utilise : $($zip.Name) (modifie le $($zip.LastWriteTime))" -ForegroundColor Yellow

# --- 2. Extraire proprement (on nettoie l'extraction precedente) ---
if (Test-Path $Extract) {
    Remove-Item $Extract -Recurse -Force
}
Expand-Archive -Path $zip.FullName -DestinationPath $Extract -Force

# --- 3. Verifier que export/web existe (sinon mauvais zip) ---
$webDir = Join-Path $Extract "export\web"
if (-not (Test-Path $webDir)) {
    Write-Host "Le dossier export\web est introuvable dans ce zip. Abandon." -ForegroundColor Red
    Write-Host "Verifie que c'est bien un export Claude Design complet." -ForegroundColor Red
    exit 1
}

# --- 4. Copier les 3 fichiers vers site/ ---
Copy-Item (Join-Path $webDir "index.html")      $RepoSite -Force
Copy-Item (Join-Path $webDir "etabli-scene.js") $RepoSite -Force
Copy-Item (Join-Path $webDir "support.js")      $RepoSite -Force
Write-Host "Fichiers copies dans site/." -ForegroundColor Green

# --- 5. Y a-t-il un changement ? ---
Set-Location $RepoRoot
$changes = git status --porcelain site/

if ([string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "Aucun changement detecte dans site/. Rien a publier." -ForegroundColor Yellow
    exit 0
}

Write-Host "Changements detectes :" -ForegroundColor Green
git status --short site/

# --- 6. Commit + push ---
$horodatage = Get-Date -Format "yyyy-MM-dd HH:mm"
git add site/
git commit -m "feat: mise a jour du site ($horodatage)"
git push

Write-Host ""
Write-Host "=== Push effectue. Le VPS deploiera dans les 2 minutes. ===" -ForegroundColor Cyan
Write-Host "Verifie ensuite https://mateosan.fr (Ctrl+F5 pour forcer le rechargement)." -ForegroundColor Cyan
