/**
 * Detect code that needs ESP32 MicroPython rather than the browser's Pyodide.
 * The ESP32-S3 USB pilot uses this as an additional hardware signal.
 * Keep this scoped to hardware-specific imports and constructors: ordinary
 * Python in Solo Python mode must continue to execute in the browser.
 */
const MICRO_PY_MODULES = new Set([
  "machine", "framebuf", "network", "esp32", "micropython",
  "neopixel", "ubluetooth", "bluetooth", "urequests",
  "usocket", "ujson", "utime", "uasyncio",
]);

function isMicroPythonModule(name) {
  const first = String(name ?? "").trim().split(".")[0];
  return MICRO_PY_MODULES.has(first);
}

export function requiresMicroPythonRuntime(source) {
  const code = String(source ?? "");
  for (const original of code.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const from = line.match(/^from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\b/);
    if (from && isMicroPythonModule(from[1])) return true;
    const imports = line.match(/^import\s+(.+)$/);
    if (imports) {
      for (const item of imports[1].split(",")) {
        const moduleName = item.trim().split(/\s+as\s+/)[0];
        if (isMicroPythonModule(moduleName)) return true;
      }
    }
    // Direct hardware constructors, even when the import is in a helper.
    // Only match statement-leading calls/assignments, not explanatory strings.
    if (/^(?:(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*\s*=\s*)?(?:machine\.)?(?:Pin|SPI|I2C|PWM|ADC|SoftI2C)\s*\(/.test(line))
      return true;
  }
  return false;
}
