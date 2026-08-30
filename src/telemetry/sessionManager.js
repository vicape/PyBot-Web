/**
 * Gestión de sesión de telemetría (API pública mínima).
 * La lógica vive en telemetryClient para un solo punto de fail-safe.
 */
export {
  initializeTelemetry as startUsageSession,
  getTelemetryState,
} from "./telemetryClient.js";
