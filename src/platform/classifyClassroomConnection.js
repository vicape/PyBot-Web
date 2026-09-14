/**
 * Clasificación del estado operativo de Google Classroom (docente).
 * No usa classroom_linked_at: sólo el resultado de una comprobación actual.
 */

export const CLASSROOM_CONNECTION = Object.freeze({
  CHECKING: "CHECKING",
  NOT_CONNECTED: "NOT_CONNECTED",
  CONNECTED: "CONNECTED",
  RECONNECT_REQUIRED: "RECONNECT_REQUIRED",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  ERROR: "ERROR",
});

/**
 * @param {unknown} err
 * @returns {{
 *   status: string,
 *   message: string | null,
 * }}
 */
export function classifyClassroomConnectionError(err) {
  const code = err?.code;
  const message = String(err?.message || "");
  const reason = String(err?.googleReason || err?.reason || "");
  const status = err?.status;

  if (code === "missing_access_token") {
    return { status: CLASSROOM_CONNECTION.NOT_CONNECTED, message: null };
  }

  if (
    code === "invalid_grant" ||
    /invalid_grant/i.test(message) ||
    /invalid_grant/i.test(String(code || ""))
  ) {
    return {
      status: CLASSROOM_CONNECTION.RECONNECT_REQUIRED,
      message: "La conexión con Google Classroom venció. Reconectá tu cuenta.",
    };
  }

  if (status === 401 || code === 401 || code === "UNAUTHENTICATED") {
    return {
      status: CLASSROOM_CONNECTION.RECONNECT_REQUIRED,
      message: "La sesión de Google Classroom venció. Reconectá tu cuenta.",
    };
  }

  const scopeInsufficient =
    code === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
    reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
    reason === "insufficientPermissions" ||
    /insufficientPermissions|insufficient.?permission|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.?authentication.?scopes|insufficient.?scope/i.test(
      message,
    ) ||
    /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason);

  if (scopeInsufficient) {
    return {
      status: CLASSROOM_CONNECTION.INSUFFICIENT_PERMISSIONS,
      message:
        "Esta conexión no tiene los permisos necesarios de Google Classroom. Reconectá para autorizarlos.",
    };
  }

  if (status === 403 || code === 403 || code === "PERMISSION_DENIED") {
    // 403 genérico: a menudo permisos/cuenta; no asumir revocación de refresh.
    return {
      status: CLASSROOM_CONNECTION.INSUFFICIENT_PERMISSIONS,
      message:
        "No pudimos acceder a Classroom con esta cuenta. Verificá que sea la cuenta docente correcta y que tenga los permisos de Classroom requeridos.",
    };
  }

  return {
    status: CLASSROOM_CONNECTION.ERROR,
    message: message || "No se pudo comunicar con Classroom.",
  };
}

/**
 * Etiqueta y variante visual del badge según estado actual.
 * @param {string} status
 * @returns {{ label: string, tone: "ok"|"muted"|"warn"|"err" }}
 */
export function classroomConnectionBadge(status) {
  switch (status) {
    case CLASSROOM_CONNECTION.CHECKING:
      return { label: "Comprobando…", tone: "muted" };
    case CLASSROOM_CONNECTION.CONNECTED:
      return { label: "Conectado", tone: "ok" };
    case CLASSROOM_CONNECTION.RECONNECT_REQUIRED:
      return { label: "Necesita reconexión", tone: "warn" };
    case CLASSROOM_CONNECTION.INSUFFICIENT_PERMISSIONS:
      return { label: "Permisos insuficientes", tone: "warn" };
    case CLASSROOM_CONNECTION.ERROR:
      return { label: "No se pudo comprobar", tone: "err" };
    case CLASSROOM_CONNECTION.NOT_CONNECTED:
    default:
      return { label: "Sin conectar", tone: "muted" };
  }
}
