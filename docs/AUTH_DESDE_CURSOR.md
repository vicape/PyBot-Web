# Iniciar sesión en GitHub desde Cursor (cuenta Google)

No hace falta una “contraseña de Git”: GitHub te abre el **navegador** y entrás con **Google** como siempre.

## 1. Git en Windows (una sola vez)

1. Descargá **Git for Windows**: https://git-scm.com/download/win  
2. Al instalar, dejá marcado **Git Credential Manager** (viene por defecto).  
3. **Cerrá y volvé a abrir** Cursor después de instalar.

## 2. Abrí esta carpeta en Cursor

**Archivo → Abrir carpeta** → `PyBot-Web` (la que tiene `package.json`).

## 3. Primera vez: commit local

En la **terminal** de Cursor (`Ctrl+ñ` o Terminal → New Terminal), en la carpeta del proyecto:

```powershell
cd C:\Users\Naro\PyBot-Web
git init
git add .
git commit -m "chore: initial PyBot-Web"
```

Si `git` no se reconoce, reiniciá Cursor o reiniciá la PC tras instalar Git.

## 4. Crear el repo vacío en GitHub (web)

1. Entrá a https://github.com con **Google**.  
2. **New repository** → nombre `PyBot-Web` → **sin** README ni .gitignore (ya los tenés local).  
3. Copiá la URL **HTTPS**, por ejemplo: `https://github.com/TU_USUARIO/PyBot-Web.git`

## 5. Enlazar y hacer push (acá se abre el login)

```powershell
git remote add origin https://github.com/TU_USUARIO/PyBot-Web.git
git branch -M main
git push -u origin main
```

- Debería abrirse el **navegador** o una ventana de **Git Credential Manager**.  
- Elegí **Sign in with GitHub** / **Browser**.  
- En la web, entrá con **Google** si te lo pide.  
- Autorizá a **Git Credential Manager** cuando GitHub pregunte.

Después de eso, los próximos `git push` desde esta PC suelen ir **sin volver a pedir** (o solo de vez en cuando).

## 6. Opcional: extensión GitHub en Cursor

1. **Extensiones** → buscá **GitHub Pull Requests and Issues** → Instalar.  
2. `Ctrl+Shift+P` → **GitHub: Sign in** → otra vez flujo por navegador con Google.

Eso ayuda al IDE; el **push por terminal** igual usa el Credential Manager si lo configuraste bien.

## Si algo falla

- **Authentication failed**: generá un **Personal Access Token** en GitHub (Settings → Developer settings → Fine-grained o classic token) y cuando Git pida contraseña, pegá el **token** en lugar de la contraseña.  
- **remote origin already exists**: `git remote remove origin` y volvé a agregar la URL correcta.
