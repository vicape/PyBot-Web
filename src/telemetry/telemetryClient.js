import {
  resolveLocalAnonymousId,
  writeLocalAnonymousId,
  isValidAnonymousId,
} from "./anonymousIdentity.js";
import { collectDeviceInfo } from "./deviceInfo.js";
import {
  ALLOWED_EVENT_NAMES,
  isDoNotTrackEnabled,
  sanitizeMetadata,
} from "./sanitizeMetadata.js";
import { getSupabase } from "../supabaseClient.js";

const HEARTBEAT_MS = 60_000;
const BATCH_MS = 15_000;
const BATCH_SIZE = 12;
const FETCH_TIMEOUT_MS = 8_000;

const IMPORTANT = new Set(["login", "logout", "error"]);

let state = {
  ready: false,
  sessionId: null,
  anonymousId: null,
  accessToken: null,
  detailed: true,
  queue: [],
  heartbeatTimer: null,
  batchTimer: null,
  ending: false,
};

async function withTimeout(promise, ms = FETCH_TIMEOUT_MS) {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

async function getAccessToken() {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function postJson(url, body, { beacon = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  const payload = JSON.stringify(body);

  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return { ok: true };
    } catch {
      // fall through
    }
  }

  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers,
      body: payload,
      credentials: "same-origin",
      keepalive: true,
    }),
  );
  if (!res.ok) {
    const err = new Error("telemetry_http");
    err.status = res.status;
    throw err;
  }
  return res.json().catch(() => ({}));
}

async function flushQueue({ force = false, beacon = false } = {}) {
  if (!state.sessionId || state.queue.length === 0) return;
  if (!force && state.queue.length < BATCH_SIZE && !beacon) return;

  const events = state.queue.splice(0, state.queue.length);
  try {
    await postJson(
      "/api/telemetry/event",
      {
        session_id: state.sessionId,
        anonymous_id: state.anonymousId,
        events,
      },
      { beacon },
    );
  } catch {
    // best-effort: no reencolar para no crecer sin límite
  }
}

function scheduleBatch() {
  if (state.batchTimer) return;
  state.batchTimer = setTimeout(() => {
    state.batchTimer = null;
    void flushQueue({ force: true });
  }, BATCH_MS);
}

function trackInternal(eventName, metadata, path) {
  if (!state.ready || !state.sessionId) return;
  if (!ALLOWED_EVENT_NAMES.has(eventName)) return;
  if (!state.detailed && !IMPORTANT.has(eventName) && eventName !== "app_open") return;

  const ev = {
    event_name: eventName,
    path: path || (typeof window !== "undefined" ? window.location?.pathname : null),
    metadata: sanitizeMetadata(metadata || {}),
  };
  state.queue.push(ev);

  if (IMPORTANT.has(eventName)) {
    void flushQueue({ force: true });
  } else {
    scheduleBatch();
    if (state.queue.length >= BATCH_SIZE) void flushQueue({ force: true });
  }
}

async function heartbeat() {
  if (!state.sessionId || state.ending) return;
  try {
    await postJson("/api/telemetry/session", {
      action: "heartbeat",
      session_id: state.sessionId,
      anonymous_id: state.anonymousId,
    });
  } catch {
    //
  }
}

function bindLifecycle() {
  if (typeof document === "undefined") return;
  const end = () => {
    if (state.ending || !state.sessionId) return;
    state.ending = true;
    void flushQueue({ force: true, beacon: true });
    try {
      postJson(
        "/api/telemetry/session",
        {
          action: "end",
          session_id: state.sessionId,
          anonymous_id: state.anonymousId,
        },
        { beacon: true },
      );
    } catch {
      //
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushQueue({ force: true, beacon: true });
    }
  });
  window.addEventListener("pagehide", end);
  window.addEventListener("beforeunload", end);
}

/**
 * Inicializa telemetría. Nunca lanza. Safe para anónimos y autenticados.
 */
export async function initializeTelemetry() {
  if (state.ready) return state;
  try {
    state.detailed = !isDoNotTrackEnabled();
    state.anonymousId = resolveLocalAnonymousId();
    state.accessToken = await getAccessToken();

    const device = collectDeviceInfo();
    const data = await postJson("/api/telemetry/session", {
      action: "start",
      anonymous_id: state.anonymousId,
      device,
      path: device.landing_path,
      consent_state: "unknown",
    });

    if (data?.anonymous_id && isValidAnonymousId(data.anonymous_id)) {
      state.anonymousId = data.anonymous_id;
      writeLocalAnonymousId(data.anonymous_id);
    }
    if (data?.session_id && isValidAnonymousId(data.session_id)) {
      state.sessionId = data.session_id;
    }

    state.ready = !!state.sessionId;
    if (!state.ready) return state;

    trackInternal("app_open", {}, device.landing_path);
    if (state.detailed) {
      trackInternal("page_view", {}, device.landing_path);
    }

    state.heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_MS);
    bindLifecycle();

    // Vincular login futuro
    try {
      const sb = getSupabase();
      if (sb) {
        sb.auth.onAuthStateChange((event, session) => {
          void onAuthChange(event, session);
        });
      }
    } catch {
      //
    }
  } catch {
    state.ready = false;
  }
  return state;
}

async function onAuthChange(event, session) {
  try {
    if (event === "SIGNED_IN" && session?.access_token) {
      state.accessToken = session.access_token;
      if (state.sessionId) {
        await postJson("/api/telemetry/session", {
          action: "authenticate",
          session_id: state.sessionId,
          anonymous_id: state.anonymousId,
        });
      }
      track("login", {});
    } else if (event === "SIGNED_OUT") {
      track("logout", {});
      await flushQueue({ force: true });
      state.accessToken = null;
      // anonymous_id y session_id se conservan
    }
  } catch {
    //
  }
}

export function track(eventName, metadata, path) {
  try {
    trackInternal(eventName, metadata, path);
  } catch {
    // never break host app
  }
}

export function trackPageView(path) {
  track("page_view", {}, path);
}

export function getTelemetryState() {
  return {
    ready: state.ready,
    sessionId: state.sessionId,
    anonymousId: state.anonymousId,
    detailed: state.detailed,
  };
}

/** Solo para tests */
export function __resetTelemetryForTests() {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  if (state.batchTimer) clearTimeout(state.batchTimer);
  state = {
    ready: false,
    sessionId: null,
    anonymousId: null,
    accessToken: null,
    detailed: true,
    queue: [],
    heartbeatTimer: null,
    batchTimer: null,
    ending: false,
  };
}
