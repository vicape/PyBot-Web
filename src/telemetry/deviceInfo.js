/** Parseo ligero de user-agent sin dependencias. */

export function collectDeviceInfo() {
  if (typeof navigator === "undefined") {
    return {
      user_agent: null,
      browser: null,
      browser_version: null,
      os: null,
      os_version: null,
      device_type: "unknown",
      language: null,
      timezone: null,
      screen_width: null,
      screen_height: null,
      referrer: null,
      landing_path: null,
    };
  }

  const ua = navigator.userAgent || "";
  const parsed = parseUserAgent(ua);
  let timezone = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    //
  }

  return {
    user_agent: ua.slice(0, 512),
    browser: parsed.browser,
    browser_version: parsed.browser_version,
    os: parsed.os,
    os_version: parsed.os_version,
    device_type: parsed.device_type,
    language: navigator.language || null,
    timezone,
    screen_width: typeof screen !== "undefined" ? screen.width : null,
    screen_height: typeof screen !== "undefined" ? screen.height : null,
    referrer: typeof document !== "undefined" ? (document.referrer || "").slice(0, 500) : null,
    landing_path:
      typeof window !== "undefined" ? (window.location?.pathname || "/").slice(0, 500) : null,
  };
}

export function parseUserAgent(ua) {
  const s = String(ua || "");
  let browser = "other";
  let browser_version = null;
  let m;

  if ((m = s.match(/Edg\/([\d.]+)/))) {
    browser = "edge";
    browser_version = m[1];
  } else if ((m = s.match(/Chrome\/([\d.]+)/))) {
    browser = "chrome";
    browser_version = m[1];
  } else if ((m = s.match(/Firefox\/([\d.]+)/))) {
    browser = "firefox";
    browser_version = m[1];
  } else if ((m = s.match(/Version\/([\d.]+).*Safari/))) {
    browser = "safari";
    browser_version = m[1];
  }

  let os = "other";
  let os_version = null;
  if (/Windows NT 10/.test(s)) {
    os = "windows";
    os_version = "10+";
  } else if (/Windows/.test(s)) os = "windows";
  else if (/Android ([\d.]+)/.test(s)) {
    os = "android";
    os_version = s.match(/Android ([\d.]+)/)?.[1] ?? null;
  } else if (/iPhone|iPad|iPod/.test(s)) {
    os = "ios";
    os_version = s.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? null;
  } else if (/Mac OS X ([\d_]+)/.test(s)) {
    os = "macos";
    os_version = s.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? null;
  } else if (/Linux/.test(s)) os = "linux";

  let device_type = "desktop";
  if (/Mobi|Android.*Mobile|iPhone/.test(s)) device_type = "mobile";
  else if (/iPad|Tablet|Android(?!.*Mobile)/.test(s)) device_type = "tablet";

  return { browser, browser_version, os, os_version, device_type };
}
