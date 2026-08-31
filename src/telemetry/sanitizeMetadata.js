const METADATA_ALLOW = new Set([
  "transport",
  "runtime_version",
  "language_mode",
  "error_code",
  "feature",
  "http_status",
  "board_type",
  "editor_mode",
  "consent_state",
  "path",
]);

const SENSITIVE_KEY_RE = /token|password|secret|authorization|cookie|code|source|wifi|ssid|credential/i;

export const ALLOWED_EVENT_NAMES = new Set([
  "app_open",
  "page_view",
  "login",
  "logout",
  "ide_open",
  "ide_run",
  "ide_stop",
  "esp32_connect",
  "esp32_disconnect",
  "ble_connect",
  "ble_disconnect",
  "usb_connect",
  "usb_disconnect",
  "activity_open",
  "activity_ide_open",
  "classroom_open",
  "error",
]);

export function sanitizeMetadata(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!METADATA_ALLOW.has(k)) continue;
    if (SENSITIVE_KEY_RE.test(k) && k !== "error_code") continue;
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

export function isDoNotTrackEnabled() {
  try {
    return navigator.doNotTrack === "1" || window.doNotTrack === "1";
  } catch {
    return false;
  }
}
