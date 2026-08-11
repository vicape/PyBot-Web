/**
 * Fuente del PyBot BLE Runtime (MicroPython) para instalar en la placa.
 *
 * El "binario" del runtime es codigo fuente MicroPython versionado en el repo
 * (firmware/pybot-ble-runtime/main.py). PyBot lo instala como `main.py` en la
 * placa reutilizando el mismo mecanismo de transferencia por raw REPL que EDA6.
 */

import bleRuntimeRaw from "../firmware/pybot-ble-runtime/main.py?raw";
import bleBootRaw from "../firmware/pybot-ble-runtime/boot.py?raw";
import { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION } from "./bleProtocol.js";

/** Se instala como main.py para arrancar solo al boot. */
export const BLE_RUNTIME_FILENAME = "main.py";

/**
 * Se instala como boot.py: MicroPython lo ejecuta ANTES de main.py y se encarga
 * del apply/rollback transaccional de una actualizacion OTA del runtime. Es el
 * archivo estable que HABILITA las futuras actualizaciones por Bluetooth (por eso
 * la instalacion por USB de "Instalar PyBot Bluetooth" ahora tambien lo graba).
 */
export const BLE_BOOT_FILENAME = "boot.py";

export { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION };

/**
 * Version del runtime PUBLICADA por esta version de PyBot Web (fuente de verdad
 * unica; el mismo texto que declara main.py por INFO). La web la compara contra
 * la version INSTALADA (INFO.firmware) para ofrecer una actualizacion OTA.
 */
export function getBleRuntimeVersion() {
  return PYBOT_RUNTIME_VERSION;
}

/** Texto del runtime (main.py) listo para grabar / transferir por OTA. */
export function getBleRuntimeSource() {
  return bleRuntimeRaw;
}

/** Texto del boot/update manager (boot.py) listo para grabar por USB. */
export function getBleBootSource() {
  return bleBootRaw;
}
