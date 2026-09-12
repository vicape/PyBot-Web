/**
 * #24 — validación de GPIOs en el adaptador esp32-serial experimental.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Esp32SerialAdapter } from "../src/esp32Session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src", "esp32Session.js");

function adapter() {
  return new Esp32SerialAdapter({
    write: async () => {},
    close: async () => {},
  });
}

test("#24 rechaza flash SPI y huecos inexistentes", () => {
  const a = adapter();
  for (const pin of [6, 7, 8, 9, 10, 11, 20, 24, 28, 29, 30, 31, -1, 40]) {
    assert.throws(() => a._gpio(pin), /INVALID_PIN/, `pin ${pin}`);
  }
});

test("#24 permite GPIOs digitales comunes", () => {
  const a = adapter();
  for (const pin of [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33]) {
    assert.equal(a._gpio(pin, "output"), pin);
  }
});

test("#24 input-only 34–39: lectura OK, salida/PWM/servo no", () => {
  const a = adapter();
  for (const pin of [34, 35, 36, 39]) {
    assert.equal(a._gpio(pin, "any"), pin);
    assert.equal(a._gpio(pin, "adc"), pin);
    assert.throws(() => a._gpio(pin, "output"), /INVALID_PIN/);
    assert.throws(() => a._gpio(pin, "pwm"), /INVALID_PIN/);
    assert.throws(() => a._gpio(pin, "servo"), /INVALID_PIN/);
  }
});

test("#24 ADC rechaza pines sin canal (p.ej. 5, 16, 21)", () => {
  const a = adapter();
  for (const pin of [5, 16, 18, 19, 21, 22, 23]) {
    assert.throws(() => a._gpio(pin, "adc"), /INVALID_PIN/);
  }
  assert.equal(a._gpio(34, "adc"), 34);
  assert.equal(a._gpio(32, "adc"), 32);
  assert.equal(a._gpio(4, "adc"), 4);
});

test("#24 pinWrite/servoWrite usan modo output/servo", async () => {
  const a = adapter();
  a._cmd = async () => ({ ok: true, value: 0 });
  await assert.rejects(() => a.pinWrite(34, 1), /INVALID_PIN/);
  await assert.rejects(() => a.servoWrite(35, 90), /INVALID_PIN/);
  await assert.rejects(() => a.pwmWrite(36, 128), /INVALID_PIN/);
  await a.pinWrite(18, 1);
  await a.servoWrite(18, 90);
});

test("#24 pinRead Axx valida ADC", async () => {
  const a = adapter();
  a._cmd = async () => ({ ok: true, value: 512 });
  await assert.rejects(() => a.pinRead("A5"), /INVALID_PIN/);
  assert.equal(await a.pinRead("A34"), 512);
});

test("#24 fuente documenta validación por modo", () => {
  const src = readFileSync(SRC, "utf8");
  assert.match(src, /mode === "adc"/);
  assert.match(src, /34, 35, 36, 39/);
  assert.match(src, /6, 7, 8, 9, 10, 11/);
});
