import { getSupabase } from "../supabaseClient.js";

export const UI_THEMES = ["system", "light", "dark"];
export const UI_BACKGROUNDS = ["default", "clean", "deep-blue", "indigo", "graphite", "custom"];

const LS_PREFIX = "pybot_appearance_";

export function isValidHexColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value ?? ""));
}

export function normalizeAppearance(partial = {}) {
  const theme = UI_THEMES.includes(partial.theme) ? partial.theme : "system";
  const background = UI_BACKGROUNDS.includes(partial.background) ? partial.background : "default";
  const customColor = isValidHexColor(partial.customColor) ? partial.customColor : "#1e3a5f";
  return { theme, background, customColor };
}

function lsKey(userId) {
  return `${LS_PREFIX}${userId || "anon"}`;
}

export function loadAppearanceFromStorage(userId) {
  try {
    const raw = localStorage.getItem(lsKey(userId));
    if (!raw) return null;
    return normalizeAppearance(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveAppearanceToStorage(userId, appearance) {
  try {
    localStorage.setItem(lsKey(userId), JSON.stringify(normalizeAppearance(appearance)));
  } catch {
    //
  }
}

export function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export async function fetchAppearance(userId) {
  const sb = getSupabase();
  const fallback = loadAppearanceFromStorage(userId) ?? normalizeAppearance({});

  if (!sb || !userId) return { appearance: fallback, source: "default" };

  const { data, error } = await sb
    .from("profiles")
    .select("ui_theme, ui_background, ui_background_color")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (error.message?.includes("does not exist")) {
      return { appearance: fallback, source: "local" };
    }
    return { appearance: fallback, source: "local" };
  }

  if (!data) return { appearance: fallback, source: "local" };

  const appearance = normalizeAppearance({
    theme: data.ui_theme,
    background: data.ui_background,
    customColor: data.ui_background_color,
  });

  saveAppearanceToStorage(userId, appearance);
  return { appearance, source: "db" };
}

export async function saveAppearance(userId, partial) {
  const appearance = normalizeAppearance(partial);
  saveAppearanceToStorage(userId, appearance);

  const sb = getSupabase();
  if (!sb || !userId) return { ok: true, appearance, skipped: true };

  const patch = {
    ui_theme: appearance.theme,
    ui_background: appearance.background,
    ui_background_color: appearance.background === "custom" ? appearance.customColor : null,
  };

  const { error } = await sb.from("profiles").update(patch).eq("id", userId);

  if (
    error?.message?.includes("does not exist") ||
    error?.message?.includes("ui_theme") ||
    error?.message?.includes("ui_background")
  ) {
    return { ok: true, appearance, skipped: true };
  }

  if (error) return { ok: false, appearance, error: error.message };
  return { ok: true, appearance, skipped: false };
}

export function applyAppearanceToElement(el, appearance) {
  if (!el) return;
  const normalized = normalizeAppearance(appearance);
  const resolved = resolveTheme(normalized.theme);
  el.dataset.pbcTheme = resolved;
  el.dataset.pbcThemePref = normalized.theme;
  el.dataset.pbcBg = normalized.background;
  if (normalized.background === "custom") {
    el.style.setProperty("--pbc-bg-custom", normalized.customColor);
  } else {
    el.style.removeProperty("--pbc-bg-custom");
  }
}
