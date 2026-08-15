/**
 * Nombres de archivos que el provisioning instala en la ESP32.
 * Debe coincidir con getBleRuntimeInstallFiles() + EDA6.py (installBleRuntime).
 * La fuente de bytes sigue siendo pybotBleRuntime / EDA6; acá solo los nombres
 * para clasificar y verificar sin imports `?raw` de Vite.
 */

export const PYBOT_MARKER_FILE = "pybot_ble.py";

/** Orden alineado a BLE_RUNTIME_MODULE_FILES + boot.py. */
export const PYBOT_RUNTIME_FILES = Object.freeze([
  "boot.py",
  "main.py",
  "pybot_ble.py",
  "pybot_run.py",
  "pybot_deploy.py",
  "pybot_update.py",
  "pybot_boot_update.py",
  "pybot_repl.py",
  "pybot_net.py",
  "pybot_mpy.py",
]);

export const PYBOT_PROVISION_EXTRA_FILES = Object.freeze(["EDA6.py"]);

export function expectedProvisionFiles() {
  const extra = PYBOT_PROVISION_EXTRA_FILES.filter((n) => !PYBOT_RUNTIME_FILES.includes(n));
  return [...PYBOT_RUNTIME_FILES, ...extra];
}

export function parseRuntimeVersionFromSource(text) {
  const m = String(text ?? "").match(/PYBOT_RUNTIME_VERSION\s*=\s*["']([\d.]+)["']/);
  return m ? m[1] : null;
}
