import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Regresion USB: `runOnBoard` DEBE priorizar la sesion SERIAL (`_mpSession`)
 * sobre BLE (`_bleRun`). No podemos importar hardwareBridge.js en Node (usa
 * imports `?raw` de Vite y globals de navegador), asi que verificamos el
 * invariante a nivel de fuente: dentro de runOnBoard, el chequeo de `_mpSession`
 * ocurre ANTES del de `_bleRun`. Si alguien invierte el orden (regresion), este
 * test falla.
 */
const src = readFileSync(
  fileURLToPath(new URL("../src/hardwareBridge.js", import.meta.url)),
  "utf8",
);

function runOnBoardBody() {
  const start = src.indexOf("export async function runOnBoard(");
  assert.ok(start >= 0, "no se encontro runOnBoard");
  // Cortar hasta el inicio de la siguiente funcion exportada.
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after >= 0 ? after : undefined);
}

test("runOnBoard checks _mpSession before _bleRun (serial priority)", () => {
  const body = runOnBoardBody();
  const idxSerial = body.indexOf("_mpSession");
  const idxBle = body.indexOf("_bleRun");
  assert.ok(idxSerial >= 0, "runOnBoard debe consultar _mpSession");
  assert.ok(idxBle >= 0, "runOnBoard debe consultar _bleRun");
  assert.ok(
    idxSerial < idxBle,
    "runOnBoard debe priorizar el serial (_mpSession) antes que BLE (_bleRun)",
  );
});

test("runOnBoard still delegates to the BLE path when there is no serial session", () => {
  const body = runOnBoardBody();
  assert.match(body, /runOnBoardBle/, "runOnBoard debe seguir ofreciendo el camino BLE");
});
