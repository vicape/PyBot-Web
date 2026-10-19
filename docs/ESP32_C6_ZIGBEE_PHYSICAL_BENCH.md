# ESP32-C6 MicroPython + Zigbee — prueba física

RAMA EXCLUSIVA: feature/esp32-universal-lab. Producción permanece intacta.
ESTADO: firmware compilado, 3 hashes SHA-256 verificados. Hardware NO VERIFICADO.

## Hardware
Waveshare ESP32-C6-LCD-1.47, ESP32-C6FH4, flash 4 MB sin PSRAM.
Usar Chrome o Edge de escritorio con Web Serial, conexión USB, HTTPS.

## Paquete descargable
https://github.com/vicape/cursor-control/actions/runs/39193349317/artifacts/12161052985
Descargar el artefacto y extraer los tres .bin del directorio zigbee-firmware-private-bench.

| Rol | Archivo | Offset | Tamaño | SHA-256 |
|---|---|---|---:|---|
| Bootloader | pybot-c6-micropython-zigbee-0.1.0-bootloader.bin | 0x0 | 18384 | 8eed4217cf16bb74313615a6a7fb9a90a4ae79c05b828dfa923e84b0f574fbe6 |
| Partition | pybot-c6-micropython-zigbee-0.1.0-partition-table.bin | 0x8000 | 3072 | b459f132d42af8ce0d3ffb047894135b9c2da262de2a85e4353e1bf84bab6e0f |
| MicroPython + Zigbee app | pybot-c6-micropython-zigbee-0.1.0-app.bin | 0x10000 | 3221280 | d22d48f5c474f327be4b946dfa88af49523606215dda5e74325a5864189ef096 |

## Paso 0: BACKUP OBLIGATORIO
Antes de instalar, guardar FUERA DE LA PLACA /main.py, /boot.py, /pybot y los assets.
Para respaldar todos los 4 MB desde una PC con esptool: python -m esptool --chip esp32c6 -p COMx read_flash 0x0 0x400000 respaldo-c6-4mb.bin
Identificar COMx correctamente antes de usarlo. Conservar original MicroPython ESP32_GENERIC_C6-20251209-v1.27.0.bin (SHA-256 111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183).
Instalar firmware experimental reemplaza el firmware actual y puede borrar toda la flash.

## Instalador desde PyBot — SOLO despliegue de la rama de prueba
1. Elegir Universal Lab → Waveshare ESP32-C6-LCD-1.47 y desconectar sesiones WebSerial existentes.
2. Menu → Probar firmware Zigbee (C6).
3. Seleccionar los tres .bin previamente extraídos.
4. Validar SHA-256; el navegador compara bytes con tamaños y hashes de ESTA compilación.
5. Confirmar backup, borrado y escribir literalmente ESP32-C6.
6. Hacer clic en Instalar firmware Zigbee experimental (manual), seleccionar puerto correcto, esperar escritura y reinicio.
7. Desconectar/reconectar USB; hacer clic Conectar en PyBot para reinstalar /pybot (incluido pybot.zigbee).
Esta opción NO se activa de forma automática ni publica el firmware en producción.

## Alternativa manual en PC (solo tras respaldo y autorización consciente)
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
