# PyBot — ESP32-S3 MicroPython (piloto aislado por USB)

**Estado:** soporte de selección, sesión USB, ejecución Python y guardado de programa implementado en la rama experimental. **NO validado físicamente** en Waveshare. No hay instalación automática del firmware ni integración de pantalla/táctil en esta etapa.

## Por qué se incorpora como perfil independiente

El ESP32-S3 no debe recibir la imagen `ESP32_GENERIC` para ESP32 clásico. El instalador actual de PyBot sigue admitiendo únicamente el ESP32 clásico. Esta etapa agrega **ESP32-S3 MicroPython (USB)**, sin modificar el instalador existente, el firmware de Arduino/EDA6 ni los runtimes BLE.

Para la Waveshare **ESP32-S3-Touch-LCD-1.54**, el fabricante declara ESP32-S3R8, 16 MB flash y 8 MB PSRAM; pantalla ST7789 (SPI) y táctil CST816 (I2C). MicroPython ofrece variantes `ESP32_GENERIC_S3`, incluyendo `SPIRAM_OCT`. Consultar los detalles antes de instalar: https://micropython.org/download/ESP32_GENERIC_S3/ y https://docs.waveshare.com/ESP32-S3-Touch-LCD-1.54.

## Uso del piloto

1. **Instalación de firmware (guía, no flasheo integrado):** en el menú ESP32-S3 PyBot ofrece enlaces para descargar el `.bin` oficial **ESP32_GENERIC_S3 → Firmware (Support for Octal-SPIRAM)** y abrir el flasheador web oficial de Espressif. Debe seleccionarse el `.bin` completo y la dirección **`0x0`** según MicroPython. Es una operación controlada por el usuario en la herramienta externa: **puede borrar el firmware de fábrica y los programas**. Respaldar primero. No usar el instalador de ESP32 clásico de PyBot.
2. En un navegador de escritorio compatible con Web Serial, seleccionar `ESP32-S3 MicroPython (USB)` en PyBot.
3. Seleccionar el puerto USB. Comprobar primero `print("Hola desde ESP32-S3")`; ejecutar después un ejemplo mínimo de Wi-Fi sin credenciales compartidas.
4. El botón **Ejecutar** usa el REPL MicroPython USB existente; el botón **Dejar programa en la placa** usa el instalador persistente existente de `main.py` y debe probarse físicamente antes de confiar en un arranque autónomo.
5. Las acciones de **Preparar ESP32**, reinstalar PyBot/BLE y desplegar por Bluetooth permanecen restringidas a las familias previamente admitidas. La función de preparación también rechaza explícitamente el nuevo perfil S3 si se invoca fuera de la UI.

## Criterios físicos pendientes

- [ ] Conexión USB/REPL estable y `print` desde PyBot.
- [ ] Ejecutar y detener programa repetidas veces.
- [ ] Wi-Fi + HTTPS desde MicroPython sin exponer claves.
- [ ] Subir un `main.py` simple y comprobar arranque/desconexión/reinicio.
- [ ] Controladores MicroPython para pantalla ST7789 y táctil CST816.
- [ ] No romper el comportamiento de Arduino, ESP32 clásico, EDA6 y BLE en regresión.

Ningún código desarrollado aquí controla directamente la red eléctrica o dispositivos Tuya. Las luces y la integración Tuya se implementarán y probarán por separado.
