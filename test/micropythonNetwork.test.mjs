import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLES } from "../src/examplesData.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const net = readFileSync(
  join(__dirname, "..", "firmware", "pybot-ble-runtime", "pybot_net.py"),
  "utf8",
);
const eda6 = readFileSync(join(__dirname, "..", "src", "assets", "EDA6.py"), "utf8");
const eda6Profile = readFileSync(
  join(__dirname, "..", "src", "eda6Profile.js"),
  "utf8",
);
const mpy = readFileSync(
  join(__dirname, "..", "firmware", "pybot-ble-runtime", "pybot_mpy.py"),
  "utf8",
);

const WIFI_FUNCS = [
  "wifi_conectar",
  "wifi_desconectar",
  "wifi_conectado",
  "wifi_ip",
  "wifi_estado",
  "wifi_signal",
];
const HTTP_FUNCS = ["web_get", "web_post"];

test("pybot_net exposes the educational Wi-Fi API", () => {
  for (const fn of WIFI_FUNCS) {
    assert.match(net, new RegExp("def " + fn + "\\("));
  }
  assert.match(net, /network\.WLAN/);
  assert.match(net, /WIFI_TIMEOUT/);
  assert.doesNotMatch(net, /while not wlan\.isconnected\(\):\s*\n\s*pass\s*$/m);
});

test("wifi_conectar has timeout and does not spin forever", () => {
  assert.match(net, /timeout/);
  assert.match(net, /WIFI_TIMEOUT/);
  assert.match(net, /STAT_WRONG_PASSWORD|WIFI_BAD_PASSWORD/);
  assert.match(net, /WIFI_NO_AP/);
});

test("pybot_net HTTP GET/POST with JSON, headers, timeout, HTTPS hook", () => {
  for (const fn of HTTP_FUNCS) {
    assert.match(net, new RegExp("def " + fn + "\\("));
  }
  assert.match(net, /class HttpResponse/);
  assert.match(net, /Content-Type.*application\/json|application\/json/);
  assert.match(net, /ssl\.wrap_socket/);
  assert.match(net, /HTTP_TIMEOUT/);
  assert.match(net, /HTTP_MAX_REDIRECTS/);
  assert.match(net, /def json\(self\)/);
});

test("EDA6 reexports network functions without duplicating them", () => {
  assert.match(eda6, /from pybot_net import/);
  for (const fn of [...WIFI_FUNCS, ...HTTP_FUNCS]) {
    assert.match(eda6, new RegExp(fn));
    assert.match(eda6Profile, new RegExp(fn));
    assert.doesNotMatch(eda6, new RegExp("def " + fn + "\\("));
  }
});

test("pybot_mpy reexports pybot_net", () => {
  assert.match(mpy, /from pybot_net import/);
});

test("examples include Wi-Fi/HTTP and Sheets without real credentials", () => {
  const wifi = EXAMPLES.find((e) => e.id === "esp32_wifi_http");
  const sheets = EXAMPLES.find((e) => e.id === "esp32_google_sheets");
  assert.ok(wifi && sheets);
  assert.match(wifi.code, /wifi_conectar/);
  assert.match(wifi.code, /web_get/);
  assert.match(sheets.code, /web_post/);
  assert.match(sheets.code, /TU_SCRIPT_ID|MiRed/);
  const blob = wifi.code + sheets.code;
  assert.doesNotMatch(blob, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(blob, /sk_live_/);
  assert.ok(wifi.boards.includes("esp32-micropython"));
  assert.ok(sheets.boards.includes("esp32-eda6"));
});

test("HTTP helper parses URLs (JS mirror of firmware _parse_url)", () => {
  function parseUrl(url) {
    let proto = "http";
    let rest = url;
    if (rest.startsWith("https://")) {
      proto = "https";
      rest = rest.slice(8);
    } else if (rest.startsWith("http://")) {
      rest = rest.slice(7);
    }
    let hostport;
    let path;
    if (rest.includes("/")) {
      const i = rest.indexOf("/");
      hostport = rest.slice(0, i);
      path = rest.slice(i);
    } else {
      hostport = rest;
      path = "/";
    }
    let host = hostport;
    let port = proto === "https" ? 443 : 80;
    if (hostport.includes(":")) {
      const j = hostport.lastIndexOf(":");
      host = hostport.slice(0, j);
      port = parseInt(hostport.slice(j + 1), 10);
    }
    return { proto, host, port, path };
  }
  assert.deepEqual(parseUrl("https://example.com/api"), {
    proto: "https",
    host: "example.com",
    port: 443,
    path: "/api",
  });
  assert.deepEqual(parseUrl("http://192.168.1.8:8080/x"), {
    proto: "http",
    host: "192.168.1.8",
    port: 8080,
    path: "/x",
  });
});
