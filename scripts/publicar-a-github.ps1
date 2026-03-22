# Ejecutar en PowerShell (clic derecho → Ejecutar con PowerShell, o desde terminal de Cursor).
# 1) Te loguea en GitHub en el navegador (Google OK)
# 2) Crea el repo "PyBot-Web" en tu cuenta y hace push

$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
# gh a veces no entra al PATH hasta reiniciar terminal — rutas tipicas:
$ghPaths = @(
    "${env:ProgramFiles}\GitHub CLI",
    "${env:ProgramFiles(x86)}\GitHub CLI"
)
foreach ($p in $ghPaths) {
    if (Test-Path $p) {
        $env:Path = "$p;$env:Path"
    }
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "No se encuentra git. Instala Git for Windows o reinicia la PC."
    exit 1
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Instalando GitHub CLI (gh) con winget..."
    winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    foreach ($p in $ghPaths) {
        if (Test-Path $p) {
            $env:Path = "$p;$env:Path"
        }
    }
}

Write-Host "`n=== Login GitHub (se abre el navegador) ===`n"
gh auth login -h github.com -p https -w

Write-Host "`n=== Crear repo PyBot-Web y subir codigo ===`n"
# Si el repo ya existe en GitHub, usar: git remote add origin ... && git push -u origin main
gh repo create PyBot-Web --public --source=. --remote=origin --push --description "PyBot web - React + Firmata + Web Serial"

Write-Host "`nListo. Repo: https://github.com/$(gh api user -q .login)/PyBot-Web"
