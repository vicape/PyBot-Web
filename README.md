# PyBot-Web

Web app (React + Vite) para controlar Arduino con **Firmata** vía **Web Serial** en Chrome (Chromebook / Mac).  
Proyecto **aparte** del IDE **PyBot** de escritorio; no reemplaza ni borra nada de ese repo.

## Estado actual

- UI, diseño y **lógica de estados** del motor / fases (igual que el ejercicio con pulsador y rebotes).
- **Firmata por serie**: pendiente de cablear (abrir puerto, baud, sysex, servo pin 10, digital pin 12).

## Desarrollo local

```bash
cd PyBot-Web
npm install
npm run dev
```

Abrí la URL que muestra Vite (Chrome).

## Subir a GitHub (lo más fácil)

👉 **[docs/LO_MAS_FACIL.md](docs/LO_MAS_FACIL.md)** — **GitHub Desktop**: instalás, entrás con **Google** en el navegador, **Add local repository** → carpeta `PyBot-Web` → **Publish repository**. Casi sin comandos.

### Desde esta PC (Git + script)

Ya está hecho **commit local** en `C:\Users\Naro\PyBot-Web` (rama `main`). Para crear el repo en GitHub y subir todo **desde acá**, en **PowerShell** (o terminal de Cursor):

```powershell
cd C:\Users\Naro\PyBot-Web
powershell -ExecutionPolicy Bypass -File .\scripts\publicar-a-github.ps1
```

Eso instala **GitHub CLI** si falta, abre el **navegador** para que entres con **Google**, crea el repo **PyBot-Web** y hace **push**.  
(Si el nombre `PyBot-Web` ya existe en tu cuenta, creá el repo vacío en la web y usá `git remote add origin ...` + `git push -u origin main` como en [docs/AUTH_DESDE_CURSOR.md](docs/AUTH_DESDE_CURSOR.md).)

Alternativa con terminal + Cursor: **[docs/AUTH_DESDE_CURSOR.md](docs/AUTH_DESDE_CURSOR.md)**.

## Deploy en Vercel (vos)

1. [vercel.com](https://vercel.com) → **Add New Project** → importar el repo `PyBot-Web`.
2. Framework: **Vite** (o dejar autodetect).
3. **Deploy**. La URL `*.vercel.app` sirve por HTTPS (necesario para Web Serial en producción).

## Notas

- Web Serial solo en **HTTPS** o `localhost`.
- Arduino con **StandardFirmata** (misma idea que PyBot escritorio).
