# ESP32-C6 MicroPython + Zigbee — prueba física

TARGET: `vicape/PyBot-Web` · RAMA EXCLUSIVA: feature/esp32-universal-lab. Producción permanece intacta.
ESTADO: firmware compilado, 3 hashes SHA-256 verificados. Hardware NO VERIFICADO.
Follow-ups: #555, #557, #558.

## Hardware
Waveshare ESP32-C6-LCD-1.47, ESP32-C6FH4, flash 4 MB sin PSRAM.
Usar Chrome o Edge de escritorio con Web Serial, conexión USB, HTTPS.

## Paquete anclado (sin .bin en git)
Manifest durable: `firmware/pybot-c6-micropython-zigbee/private-bench-manifest.json`
Notices: `firmware/pybot-c6-micropython-zigbee/THIRD_PARTY_NOTICES.md`
Provenance Maxwell: run `39193349317` / artifact `12161052985` (no es URL de fetch del browser).

| Rol | Archivo | Offset | Tamaño | SHA-256 |
|---|---|---|---:|---|
| Bootloader | pybot-c6-micropython-zigbee-0.1.0-bootloader.bin | 0x0 | 18384 | 8eed4217cf16bb74313615a6a7fb9a90a4ae79c05b828dfa923e84b0f574fbe6 |
| Partition | pybot-c6-micropython-zigbee-0.1.0-partition-table.bin | 0x8000 | 3072 | b459f132d42af8ce0d3ffb047894135b9c2da262de2a85e4353e1bf84bab6e0f |
| MicroPython + Zigbee app | pybot-c6-micropython-zigbee-0.1.0-app.bin | 0x10000 | 3221280 | d22d48f5c474f327be4b946dfa88af49523606215dda5e74325a5864189ef096 |

## Entrega automática (usuario final)
El instalador llama `Obtener firmware y verificar` → `POST/GET /api/c6-zigbee-bench-firmware`
(autenticación Supabase + allowlist de operador + tickets HMAC de corta vida + verificación SHA).
El usuario **nunca** descarga ZIP de GitHub ni selecciona los 3 `.bin`.

## Setup one-time del operador (NO end-user)
Si Preview aún no sirve el paquete: subir los 3 `.bin` del artefacto Maxwell a object storage privado
durable (más allá de la retención de GitHub Actions) y configurar en Vercel Preview:

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PYBOT_C6_FIRMWARE_OPERATOR_EMAILS`,
`PYBOT_C6_FIRMWARE_SIGNING_SECRET`, `PYBOT_C6_FIRMWARE_STORAGE_BASE_URL`,
`PYBOT_C6_FIRMWARE_STORAGE_AUTH_HEADER`.

Interim opcional: `PYBOT_C6_FIRMWARE_GITHUB_TOKEN` + `PYBOT_C6_FIRMWARE_GHA_ARTIFACT_ID=12161052985`
+ `PYBOT_C6_FIRMWARE_GHA_REPO=vicape/cursor-control` (migrar a storage durable antes del expiry).

## Paso 0: BACKUP OBLIGATORIO
Antes de instalar, guardar FUERA DE LA PLACA `/main.py`, `/boot.py`, `/pybot/assets` (vía imagen flash completa 4 MB).
Para respaldar todos los 4 MB desde una PC con esptool: python -m esptool --chip esp32c6 -p COMx read_flash 0x0 0x400000 respaldo-c6-4mb.bin
Identificar COMx correctamente antes de usarlo. Conservar original MicroPython ESP32_GENERIC_C6-20251209-v1.27.0.bin (SHA-256 111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183).
Instalar firmware experimental reemplaza el firmware actual y puede borrar toda la flash.

## Instalador guiado desde PyBot — SOLO despliegue de la rama de prueba
Etiqueta de UI exacta: **Preparar e instalar**.

1. Elegir Universal Lab → Waveshare ESP32-C6-LCD-1.47 y desconectar sesiones WebSerial existentes.
2. Menú → **Preparar e instalar**.
3. Detectar ESP32-C6 real y flash **4 MB**; si falla, la instalación no continúa.
4. **Obtener firmware y verificar** (servidor autenticado + SHA); sin file-picker.
5. Respaldar **toda** la flash 4 MB (`read_flash`) a un archivo local del usuario (preserva `/main.py`, `/boot.py`, `/pybot/assets` en la imagen completa). Si el navegador no confirma la descarga, acuse explícito obligatorio.
6. Confirmar borrado destructivo, escribir literalmente `ESP32-C6`, elegir el puerto correcto (sin auto-flash).
7. Tras grabar: checklist REPL / `_uzigbee` / ST7789 / GPIO / Wi-Fi / BLE; pairing Zigbee y dual ON/OFF quedan **UNVERIFIED** hasta prueba física.
8. Desconectar/reconectar USB; Conectar en PyBot para reinstalar `/pybot`.
Esta opción NO se activa de forma automática ni publica el firmware en producción.

## Alternativa manual en PC (solo operador / recuperación)
python -m esptool --chip esp32c6 -p COMx write_flash 0x0 pybot-c6-micropython-zigbee-0.1.0-bootloader.bin 0x8000 pybot-c6-micropython-zigbee-0.1.0-partition-table.bin 0x10000 pybot-c6-micropython-zigbee-0.1.0-app.bin
NUNCA escribir app-only en offset 0. No desconectar USB durante escritura.

## Pruebas físicas mínimas
- Comprobar MicroPython por USB REPL: print('OK').
- Importar de verdad el módulo nativo: import _uzigbee.
- Tras Conectar PyBot (rama de prueba): from pybot import zigbee, display.
- Pantalla ST7789 172×320: inicializar, dibujar y refrescar; verificar al mismo tiempo que Zigbee.
- GPIO, WiFi, Bluetooth y memoria libre deben funcionar sin regresiones.
- Zigbee: crear red, permitir pairing por intervalo limitado, detectar endpoints reales del switch doble y probar ambos canales ON/OFF.
- Reiniciar y comprobar reconexión, persistencia, estabilidad y RAM/heap.
- Registrar logs y evidencias: la compilación cloud NO demuestra estos comportamientos.

## Recuperación
Si no inicia, entrar en BOOT/RESET y recuperar respaldo completo 4MB con esptool desde PC. Alternativamente restaurar imagen oficial MicroPython validada con SHA mediante write_flash 0, volver a instalar /pybot y restaurar archivos de usuario.

No autorizar main/producción hasta superar pruebas físicas y obtener una nueva autorización expresa.
