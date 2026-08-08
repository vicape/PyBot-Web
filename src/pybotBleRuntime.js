/**
 * Fuente del PyBot BLE Runtime (MicroPython) para instalar en la placa.
 *
 * El "binario" del runtime es codigo fuente MicroPython versionado en el repo
 * (firmware/pybot-ble-runtime/main.py). PyBot lo instala como `main.py` en la
 * placa reutilizando el mismo mecanismo de transferencia por raw REPL que EDA6.
 */

import bleRuntimeRaw from "../firmware/pybot-ble-runtime/main.py?raw";
import { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION } from "./bleProtocol.js";

/** Se instala como main.py para arrancar solo al boot. */
export const BLE_RUNTIME_FILENAME = "main.py";

export { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION };

/** Texto del runtime listo para grabar en la placa. */
export function getBleRuntimeSource() {
  return bleRuntimeRaw;
}
