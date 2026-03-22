@echo off
title PyBot-Web - Login GitHub y subir codigo
cd /d "%~dp0"

echo.
echo  PASO 1: Se abrira el navegador - entra con Google
echo  PASO 2: Al terminar el login, se crea el repo y se sube todo
echo.
pause

set "PATH=C:\Program Files\GitHub CLI;%PATH%"
set "PATH=C:\Program Files\Git\bin;%PATH%"

where gh >nul 2>&1
if errorlevel 1 (
  echo No se encuentra gh.exe. Instala GitHub CLI o reinicia la PC.
  pause
  exit /b 1
)

echo.
echo === Login GitHub ===
gh auth login -h github.com -p https -w
if errorlevel 1 (
  echo Login cancelado o fallo.
  pause
  exit /b 1
)

echo.
echo === Crear repo PyBot-Web y push ===
git remote remove origin 2>nul
gh repo create PyBot-Web --public --source=. --remote=origin --push --description "PyBot Web - React + Firmata"
if errorlevel 1 (
  echo.
  echo Si el repo YA EXISTE, ejecuta manualmente:
  echo   git remote add origin https://github.com/TU_USUARIO/PyBot-Web.git
  echo   git push -u origin main
  pause
  exit /b 1
)

echo.
echo LISTO - Abri tu repo en github.com
pause
