# PyBot-Web — IDE en el navegador

IDE **tipo PyBot de escritorio**: barra de actividad, sidebar con **ejemplos**, **editor Monaco** (Python), **terminal**, **Run/Stop**, **Conectar USB** (Web Serial + **StandardFirmata**), **ajustes** (tema claro/oscuro, idioma ES/EN), **ayuda**.

Repo: https://github.com/vicape/PyBot-Web  
Proyecto **aparte** del PyBot de escritorio; no lo modifica.

## Python en el navegador

- **Pyodide** (carga desde CDN la primera vez; puede tardar).
- Misma API que PyBot: `pin`, `servo`, `motor`, `wait`, `print` — en la web van con **`await`** y al final **`await main()`** (no `asyncio.run(main())`: Pyodide ya tiene un event loop activo).

## Hardware

- **Chrome** + **HTTPS** (Vercel) o `localhost`.
- Arduino con **StandardFirmata** (57600 / 115200).
- Firmata en JS: digital in/out, PWM, servo, motor, analógico A0–A5.

## Desarrollo

```bash
cd PyBot-Web
npm install
npm run dev
```

## GitHub / Vercel

- **[docs/LO_MAS_FACIL.md](docs/LO_MAS_FACIL.md)** — GitHub Desktop.
- **Vercel**: importar repo, framework **Vite**, deploy.

## Notas

- `input()` de consola no está soportado como en escritorio; los ejemplos web evitan o usan bucles fijos.
- **Detener**: Stop marca bandera; el código debe usar `await wait(...)` o await en API para poder cortar entre pasos.
