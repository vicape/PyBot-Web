# Restaura logos respaldados en public/branding/backup/
# Uso:
#   .\scripts\restore-logo.ps1              # lista presets
#   .\scripts\restore-logo.ps1 before-chip  # vuelve al robot anterior
#   .\scripts\restore-logo.ps1 chip         # logo chip actual
param(
  [Parameter(Position = 0)]
  [string]$Preset
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$branding = Join-Path $root "public\branding"
$backup = Join-Path $branding "backup"

$presets = @{
  "before-chip" = @{
    logo = "pybot-logo.before-chip.png"
    mark = "pybot-mark.before-chip.png"
    light = $null
    note = "Robot cartoon anterior (pre chip)"
  }
  "chip" = @{
    logo = "pybot-logo.chip-dark.png"
    mark = "pybot-mark.chip.png"
    light = "pybot-logo.chip-light.png"
    note = "Chip actual (oscuro + claro + mark)"
  }
  "v5-clean" = @{
    logo = "pybot-logo.v5-clean.png"
    mark = "pybot-mark.v5.png"
    light = $null
    note = "Robot limpio v5"
  }
}

if (-not $Preset) {
  Write-Host "Presets disponibles:"
  foreach ($key in ($presets.Keys | Sort-Object)) {
    $p = $presets[$key]
    Write-Host ("  {0,-14} {1}" -f $key, $p.note)
  }
  Write-Host ""
  Write-Host "Ejemplo: .\scripts\restore-logo.ps1 before-chip"
  exit 0
}

if (-not $presets.ContainsKey($Preset)) {
  Write-Error "Preset desconocido: $Preset"
}

$p = $presets[$Preset]
$logoSrc = Join-Path $backup $p.logo
$markSrc = Join-Path $backup $p.mark
if (-not (Test-Path $logoSrc)) { Write-Error "Falta $logoSrc" }
if (-not (Test-Path $markSrc)) { Write-Error "Falta $markSrc" }

Copy-Item -Force $logoSrc (Join-Path $branding "pybot-logo.png")
Copy-Item -Force $markSrc (Join-Path $branding "pybot-mark.png")
if ($p.light) {
  $lightSrc = Join-Path $backup $p.light
  if (Test-Path $lightSrc) {
    Copy-Item -Force $lightSrc (Join-Path $branding "pybot-logo-light.png")
  }
}

Write-Host "Restaurado preset: $Preset"
Write-Host "  logo -> public/branding/pybot-logo.png"
Write-Host "  mark -> public/branding/pybot-mark.png"
Write-Host "Recarga con Ctrl+Shift+R. Si el header sigue con estilo chip/robot, avisame para revertir tambien el JSX."
