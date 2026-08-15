/**
 * Carga perezosa de esptool-js (Espressif, Apache-2.0).
 * NO importar estáticamente: el chunk no debe entrar en el bundle inicial Arduino.
 */

export async function importEsptool() {
  return import("esptool-js");
}
