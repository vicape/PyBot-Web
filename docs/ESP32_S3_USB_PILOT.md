# PyBot — ESP32-S3 MicroPython, instalador integrado (PR experimental)

**Estado:** implementación de software en la rama `test/esp32-s3-micropython-20261102`. **No validado físicamente** en la Waveshare. Ningún despliegue de producción o cambio en `main` autorizado.

## Hardware y firmware correcto

Waveshare ESP32-S3-Touch-LCD-1.54 incorpora ESP32-S3R8, 16 MiB de flash y 8 MiB de PSRAM **octal**. Solo debe usarse la versión **MicroPython ESP32_GENERIC_S3-SPIRAM_OCT**, no la de ESP32 clásico.

Imagen oficial estable fija (v1.29.0, 2026-08-24):
`ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin`

- Origen: https://micropython.org/download/ESP32_GENERIC_S3/
- Descarga oficial: https://micropython.org/resources/firmware/ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin
- Tamaño: **1.786.704 bytes**
- SHA-256 oficial observado en GitHub Actions (exactamente el archivo fuente): `ab24eadfe3ef0e6ee38834d730e648def7cd82f3fa51ee0bbc59c29a6e1bd176`
- Dirección flash **`0x0`**, distinta de ESP32 clásico **`0x1000`**.
- URL fija en PyBot con proxy de solo este recurso oficial (Vercel y Vite). El verificador bloquea **antes de borrar** si los bytes difieren en tamaño o SHA-256, o si no puede descargarse.

## Instalación desde PyBot (sin flasheador externo)

1. Abrí PyBot en la rama de prueba y elegí **Placa → ESP32-S3 MicroPython (USB)**.
2. Pulsá **Preparar ESP32-S3 desde PyBot** o el botón **Preparar ESP32** del diálogo de conexión.
3. Elegí el puerto USB de **esta Waveshare** (no conectar otra placa por error).
4. PyBot intenta leer MicroPython. Si ya responde, **no borra ni reinstala** nada y ofrece ejecución USB.
5. Si el REPL no responde, PyBot pregunta expresamente si autorizás **borrar toda la flash**. **El firmware de fábrica y programas se perderán**; respaldalos antes de confirmar.
6. Tras aceptar, esptool-js identifica la ROM ESP32-S3. Si el chip no es S3, bloquea sin borrar. Descarga la versión fija y verifica SHA-256 y tamaño antes de borrar.
7. Solo entonces ejecuta `eraseFlash`, escribe firmware a `0x0`, verifica mediante esptool-js, reinicia y comprueba nuevamente el REPL MicroPython.
8. Si el puerto cambia de enumeración USB tras el reinicio, puede requerir RESET/reconectar manualmente. **No se repite automáticamente el flasheo**, para evitar borrados adicionales.
9. Cuando muestra **ESP32-S3 conectada con MicroPython**, usá Ejecutar con `print("ESP32-S3 listo")` y después el ensayo de pantalla ST7789.

**No instala EDA6 ni runtime Bluetooth.** Ambos permanecen limitados a los perfiles previos. Los drivers MicroPython de pantalla táctil y Tuya son tareas separadas.

## Condiciones para promover

- [ ] CI: tests del S3, contratos de proyecto y comparación contra commit base sin nuevas regresiones.
- [ ] Prueba física: instalar imagen oficial desde PyBot, confirmar chip, borrar/escribir, verificar, reconectar.
- [ ] Probar cancelación, placa incorrecta, puerto perdido, PSRAM y RAM libre.
- [ ] Run/Stop sin caída a Pyodide, Wi-Fi y ejecución persistente; nunca probar hardware eléctrico sin aislamiento adecuado.
- [ ] Consentimiento para cualquier merge o despliegue.

**El resultado de pruebas automatizadas no certifica funcionamiento en hardware real.**
