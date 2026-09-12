import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MicroPythonSession } from "../src/micropythonEsp32Session.js";
import { BYTE_CTRL_C } from "../src/micropython/constants.js";
import { FakeMicroPythonTransport } from "./helpers/fakeMicroPython.mjs";

function sessionOf(opts) {
  return new MicroPythonSession(new FakeMicroPythonTransport(opts), 115200);
}

function countCtrlC(writes) {
  let n = 0;
  for (const w of writes) {
    for (const b of w) if (b === BYTE_CTRL_C) n += 1;
  }
  return n;
}

test("detect() finds a MicroPython raw REPL banner", async () => {
  const s = sessionOf();
  assert.equal(await s.detect(), true);
  await s.close();
});

test("B: print HOLA in the same OK chunk", async () => {
  const s = sessionOf({ sameChunk: true });
  await s.detect();
  let out = "";
  await s.runProgram('print("HOLA")', {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  assert.match(out, /HOLA/);
  await s.close();
});

test("runProgram streams stdout after exact OK bytes", async () => {
  const s = sessionOf();
  await s.detect();
  let out = "";
  await s.runProgram('print("hola")', {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  assert.match(out, /hola/);
  await s.close();
});

test("M: while True pass → Stop → un Ctrl+C durante exec → interrupted", async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  let out = "";
  const p = s.runProgram("while True:\n    pass\n", {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const before = board.ctrlCDuringExec;
  await s.interrupt();
  const result = await p;
  assert.equal(board.ctrlCDuringExec, before + 1);
  assert.equal(result.interrupted, true);
  assert.match(out, /Detenido/);
  await s.close();
});

test("N: CPU-bound loop Stop is interrupted, not an error", async () => {
  const s = sessionOf();
  await s.detect();
  let err = "";
  const p = s.runProgram("i = 0\nwhile True:\n    i += 1\n", {
    prelude: "",
    onErr: (c) => {
      err += c;
    },
    onOut: () => {},
  });
  await new Promise((r) => setTimeout(r, 20));
  await s.interrupt();
  const result = await p;
  assert.equal(result.interrupted, true);
  assert.equal(err.includes("Traceback"), false);
  await s.close();
});

test("O: print loop Stop without STOP:FORCE", async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  const p = s.runProgram("i = 0\nwhile True:\n    print(i)\n    i += 1\n", {
    prelude: "",
    onOut: () => {},
  });
  await new Promise((r) => setTimeout(r, 20));
  await s.interrupt();
  await p;
  assert.equal(board.forceStopSeen, false);
  await s.close();
});

test("P: Run → Stop → Run", async () => {
  const s = sessionOf();
  await s.detect();
  const p1 = s.runProgram("while True:\n    pass\n", { prelude: "", onOut: () => {} });
  await new Promise((r) => setTimeout(r, 15));
  await s.interrupt();
  await p1;
  let out2 = "";
  await s.runProgram('print("second")\n', {
    prelude: "",
    onOut: (c) => {
      out2 += c;
    },
  });
  assert.match(out2, /second/);
  await s.close();
});

test("Q: 20 real while True pass Run/Stop cycles", { timeout: 30000 }, async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  for (let i = 0; i < 20; i++) {
    let out = "";
    const p = s.runProgram("while True:\n    pass\n", {
      prelude: "",
      onOut: (c) => {
        out += c;
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    await s.interrupt();
    const result = await p;
    assert.equal(result.interrupted, true, "cycle " + i);
    assert.match(out, /Detenido/, "cycle " + i);
  }
  await s.close();
});

test("fileExists uses raw REPL markers", async () => {
  const s = sessionOf();
  assert.equal(await s.fileExists("main.py"), true);
  await s.close();
});

test("wrap includes _pybot_cleanup in the program sent to the board", async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  await s.runProgram('print("x")', { prelude: "", onOut: () => {} });
  const sent = board.writes.map((w) => new TextDecoder().decode(w)).join("");
  assert.match(sent, /_pybot_cleanup/);
  await s.close();
});

/* ------------------------------------------------------------------ */
/* Punto 9: installFile atómico (temp → verify → commit / rollback)   */
/* ------------------------------------------------------------------ */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Simula el subset de scripts que installFile envía al REPL.
 * @param {Map<string, Uint8Array>} fs
 * @param {string} code
 * @param {{ failMode?: string, chunkCount?: { n: number }, onChunk?: Function }} hooks
 */
function simulateInstallScript(fs, code, hooks = {}) {
  const scripts = hooks.scripts;
  if (scripts) scripts.push(code);

  if (/open\('([^']+)', 'wb'\)/.test(code) && /__pybot_tmp/.test(code) && !/os\.rename/.test(code)) {
    const m = code.match(/open\('([^']+)', 'wb'\)/);
    const temp = m[1];
    fs.set(temp, new Uint8Array(0));
    return { stdout: "PYBOT_INSTALL_OK\n", stderr: "" };
  }

  if (/a2b_base64\('([^']*)'\)/.test(code)) {
    hooks.chunkCount.n = (hooks.chunkCount.n || 0) + 1;
    if (hooks.failMode === "chunk1" && hooks.chunkCount.n === 1) {
      throw new Error("REPL_TIMEOUT");
    }
    if (hooks.failMode === "chunkMid" && hooks.chunkCount.n === 2) {
      throw new Error("REPL_TIMEOUT");
    }
    const temp = code.match(/open\('([^']+)', 'ab'\)/)[1];
    const b64 = code.match(/a2b_base64\('([^']*)'\)/)[1];
    const piece = b64ToBytes(b64);
    const prev = fs.get(temp) || new Uint8Array(0);
    const next = new Uint8Array(prev.length + piece.length);
    next.set(prev);
    next.set(piece, prev.length);
    fs.set(temp, next);
    if (hooks.onChunk) hooks.onChunk(hooks.chunkCount.n, temp, fs);
    return { stdout: "PYBOT_INSTALL_OK\n", stderr: "" };
  }

  if (/os\.rename/.test(code) && /PYBOT_INSTALL_/.test(code)) {
    const T = code.match(/T='([^']+)'/)[1];
    const F = code.match(/F='([^']+)'/)[1];
    const B = code.match(/B='([^']+)'/)[1];
    const E = Number(code.match(/E=(\d+)/)[1]);
    const sz = (p) => (fs.has(p) ? fs.get(p).length : -1);
    const rm = (p) => fs.delete(p);
    let backupMade = false;
    let placed = false;

    // Guardrail: commit must not rm a generic preexisting __pybot_bak (no nonce).
    assert.doesNotMatch(code, /_rm\([^)]*__pybot_bak'\)/);
    assert.match(code, /backup_made = False/);
    assert.match(code, /backup_made = True/);
    assert.match(code, /placed = False/);
    assert.match(B, /__pybot_bak_/);

    if (hooks.failMode === "verifySize") {
      fs.set(T, new Uint8Array(Math.max(0, E - 1)));
    }

    try {
      if (sz(T) !== E) throw new Error("temp");
      const had = fs.has(F);
      if (had) {
        fs.set(B, fs.get(F));
        rm(F);
        backupMade = true;
      }
      if (hooks.failMode === "renameFinal") {
        throw new Error("rename T->F");
      }
      fs.set(F, fs.get(T));
      rm(T);
      placed = true;
      if (hooks.failMode === "statFinalThrows") {
        throw new Error("stat final");
      }
      if (hooks.failMode === "verifyFinal" || hooks.failMode === "rollbackFail") {
        fs.set(F, new Uint8Array(E > 0 ? E - 1 : 1));
      }
      if (sz(F) !== E) throw new Error("final size");
      if (backupMade) rm(B);
      return { stdout: "PYBOT_INSTALL_OK\n", stderr: "" };
    } catch {
      if (backupMade) {
        rm(F);
        if (hooks.failMode === "rollbackFail") {
          // TXBAK survives with OLD; final unrestored.
          return { stdout: "PYBOT_INSTALL_FAIL\n", stderr: "" };
        }
        if (fs.has(B)) {
          fs.set(F, fs.get(B));
          rm(B);
        }
      } else {
        rm(T);
        if (placed) rm(F);
      }
      return { stdout: "PYBOT_INSTALL_FAIL\n", stderr: "" };
    }
  }

  if (/os\.remove\('([^']+__pybot_tmp)'\)/.test(code) && !/os\.rename/.test(code)) {
    const m = code.match(/os\.remove\('([^']+__pybot_tmp)'\)/);
    if (m) fs.delete(m[1]);
    return { stdout: "PYBOT_INSTALL_OK\n", stderr: "" };
  }

  return { stdout: "PYBOT_INSTALL_OK\n", stderr: "" };
}

async function installSession(initialFiles = {}, hooks = {}) {
  const fs = new Map();
  for (const [k, v] of Object.entries(initialFiles)) {
    fs.set(k, typeof v === "string" ? ENC.encode(v) : v);
  }
  hooks.chunkCount = hooks.chunkCount || { n: 0 };
  hooks.scripts = hooks.scripts || [];
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  s.execRaw = async (code) => simulateInstallScript(fs, code, hooks);
  return { s, fs, hooks, board };
}

function fsText(fs, path) {
  const b = fs.get(path);
  return b ? DEC.decode(b) : null;
}

test("installFile: replaces existing via temp without truncating final early", async () => {
  const { s, fs, hooks } = await installSession({ "EDA6.py": "OLD" });
  const progress = [];
  await s.installFile("EDA6.py", "NEW CONTENT", {
    onProgress: (info) => progress.push(info),
  });
  assert.equal(fsText(fs, "EDA6.py"), "NEW CONTENT");
  assert.equal(fs.has("EDA6.py.__pybot_tmp"), false);
  assert.equal([...fs.keys()].some((k) => /EDA6\.py\.__pybot_bak_/.test(k)), false);
  assert.ok(hooks.scripts.some((c) => /__pybot_tmp/.test(c) && /'wb'/.test(c)));
  assert.ok(hooks.scripts.every((c) => !/open\('EDA6\.py', 'wb'\)/.test(c)));
  assert.ok(hooks.scripts.every((c) => !/open\('EDA6\.py', 'ab'\)/.test(c)));
  assert.ok(progress.length >= 1);
  assert.equal(typeof progress[0].done, "number");
  assert.equal(typeof progress[0].total, "number");
  assert.equal(typeof progress[0].pct, "number");
  assert.equal(progress[0].total, new TextEncoder().encode("NEW CONTENT").length);
  assert.equal(progress[progress.length - 1].done, progress[0].total);
  await s.close();
});

test("installFile: chunk failure leaves previous final intact", async () => {
  const { s, fs } = await installSession({ "main.py": "KEEP" }, { failMode: "chunk1" });
  await assert.rejects(() => s.installFile("main.py", "x".repeat(2000)), /REPL_TIMEOUT|INSTALL_FAIL/);
  assert.equal(fsText(fs, "main.py"), "KEEP");
  assert.ok(!fs.has("main.py") || fsText(fs, "main.py") === "KEEP");
  await s.close();
});

test("installFile: mid-transfer failure leaves previous final intact", async () => {
  const big = "Z".repeat(2000);
  const { s, fs } = await installSession({ "pybot_ble.py": "KEEP_BLE" }, { failMode: "chunkMid" });
  await assert.rejects(() => s.installFile("pybot_ble.py", big), /REPL_TIMEOUT|INSTALL_FAIL/);
  assert.equal(fsText(fs, "pybot_ble.py"), "KEEP_BLE");
  await s.close();
});

test("installFile: bad temp size does not commit", async () => {
  const { s, fs } = await installSession({ "EDA6.py": "OLD" }, { failMode: "verifySize" });
  await assert.rejects(() => s.installFile("EDA6.py", "NEW"), /INSTALL_FAIL/);
  assert.equal(fsText(fs, "EDA6.py"), "OLD");
  assert.equal(fs.has("EDA6.py.__pybot_tmp"), false);
  await s.close();
});

test("installFile: rename temp->final failure restores backup", async () => {
  const { s, fs } = await installSession({ "EDA6.py": "OLD" }, { failMode: "renameFinal" });
  await assert.rejects(() => s.installFile("EDA6.py", "NEW"), /INSTALL_FAIL/);
  assert.equal(fsText(fs, "EDA6.py"), "OLD");
  await s.close();
});

test("installFile: final verify failure restores backup", async () => {
  const { s, fs } = await installSession({ "EDA6.py": "OLD" }, { failMode: "verifyFinal" });
  await assert.rejects(() => s.installFile("EDA6.py", "NEW"), /INSTALL_FAIL/);
  assert.equal(fsText(fs, "EDA6.py"), "OLD");
  await s.close();
});

test("installFile: new file without prior final", async () => {
  const { s, fs } = await installSession();
  await s.installFile("fresh.py", "hello");
  assert.equal(fsText(fs, "fresh.py"), "hello");
  assert.equal(fs.has("fresh.py.__pybot_tmp"), false);
  await s.close();
});

test("installFile: empty content installs size 0", async () => {
  const { s, fs } = await installSession();
  await s.installFile("empty.py", "");
  assert.ok(fs.has("empty.py"));
  assert.equal(fs.get("empty.py").length, 0);
  await s.close();
});

test("installFile: UTF-8 multibyte uses byte length not string length", async () => {
  const content = "áéñ — ESP32";
  const expected = ENC.encode(content).length;
  assert.notEqual(expected, content.length);
  const { s, fs, hooks } = await installSession();
  await s.installFile("utf8.py", content);
  assert.equal(fs.get("utf8.py").length, expected);
  assert.equal(fsText(fs, "utf8.py"), content);
  const commit = hooks.scripts.find((c) => /E=\d+/.test(c) && /os\.rename/.test(c));
  assert.ok(commit);
  assert.match(commit, new RegExp(`E=${expected}`));
  await s.close();
});

test("installFile: obsolete temp is cleared without touching final", async () => {
  const { s, fs, hooks } = await installSession({
    "EDA6.py": "OLD",
    "EDA6.py.__pybot_tmp": "STALE",
  });
  await s.installFile("EDA6.py", "NEW");
  assert.equal(fsText(fs, "EDA6.py"), "NEW");
  assert.ok(hooks.scripts[0].includes("os.remove('EDA6.py.__pybot_tmp')"));
  assert.ok(hooks.scripts.every((c) => !/open\('EDA6\.py', 'wb'\)/.test(c)));
  await s.close();
});

test("installFile: progress is UTF-8 byte-based (#23)", async () => {
  const content = "A".repeat(1500); // enough for >1 b64 chunk of 1024
  const { s } = await installSession();
  const progress = [];
  await s.installFile("big.py", content, { onProgress: (p) => progress.push({ ...p }) });
  assert.ok(progress.length >= 2);
  assert.equal(progress[0].total, 1500);
  assert.equal(progress[progress.length - 1].done, 1500);
  assert.equal(progress[progress.length - 1].pct, 100);
  let prev = -1;
  for (const p of progress) {
    assert.ok(p.done >= prev);
    assert.ok(p.done <= p.total);
    assert.ok(p.pct <= 100);
    prev = p.done;
  }
  await s.close();
});

test("installFile: progress UTF-8 multibyte (—, á, º) uses byte length (#23)", async () => {
  const content = "café — º\n" + "x".repeat(1200);
  const byteLen = new TextEncoder().encode(content).length;
  const { s } = await installSession();
  const progress = [];
  await s.installFile("utf8.py", content, { onProgress: (p) => progress.push({ ...p }) });
  assert.equal(progress[0].total, byteLen);
  assert.equal(progress[progress.length - 1].done, byteLen);
  assert.equal(progress[progress.length - 1].pct, 100);
  await s.close();
});

test("#23 hardwareBridge installBleRuntime suma bytes UTF-8", () => {
  const bridge = readFileSync(new URL("../src/hardwareBridge.js", import.meta.url), "utf8");
  const fn = bridge.slice(
    bridge.indexOf("export async function installBleRuntime"),
    bridge.indexOf("export async function clearPersistentAppUsb"),
  );
  assert.match(fn, /TextEncoder\(\)\.encode/);
  assert.match(fn, /info\?\.done/);
  assert.doesNotMatch(fn, /String\(f\.source \?\? ""\)\.length/);
});

test("installFile: preexisting generic backup is not deleted during commit", async () => {
  const { s, fs, hooks } = await installSession({
    "EDA6.py": "OLD",
    "EDA6.py.__pybot_bak": "VERY_OLD_BACKUP",
  });
  await s.installFile("EDA6.py", "NEW");
  assert.equal(fsText(fs, "EDA6.py"), "NEW");
  assert.equal(fsText(fs, "EDA6.py.__pybot_bak"), "VERY_OLD_BACKUP");
  const commit = hooks.scripts.find((c) => /backup_made/.test(c));
  assert.ok(commit);
  assert.match(commit, /B='EDA6\.py\.__pybot_bak_[^']+'/);
  assert.doesNotMatch(commit, /_rm\(B\).*rename\(F, B\)/s);
  assert.doesNotMatch(commit, /os\.remove\('EDA6\.py\.__pybot_bak'\)/);
  await s.close();
});

test("installFile: exception after F->TXBAK during final stat restores OLD", async () => {
  const { s, fs } = await installSession({ "EDA6.py": "OLD" }, { failMode: "statFinalThrows" });
  await assert.rejects(() => s.installFile("EDA6.py", "NEW"), /INSTALL_FAIL/);
  assert.equal(fsText(fs, "EDA6.py"), "OLD");
  assert.equal([...fs.keys()].some((k) => /EDA6\.py\.__pybot_bak_/.test(k)), false);
  await s.close();
});

test("installFile: temp->final rename exception restores OLD", async () => {
  const { s, fs } = await installSession({ "EDA6.py": "OLD" }, { failMode: "renameFinal" });
  await assert.rejects(() => s.installFile("EDA6.py", "NEW"), /INSTALL_FAIL/);
  assert.equal(fsText(fs, "EDA6.py"), "OLD");
  await s.close();
});

test("installFile: failed rollback keeps transactional backup with OLD", async () => {
  const { s, fs } = await installSession({ "EDA6.py": "OLD" }, { failMode: "rollbackFail" });
  await assert.rejects(() => s.installFile("EDA6.py", "NEW"), /INSTALL_FAIL/);
  const txKeys = [...fs.keys()].filter((k) => /EDA6\.py\.__pybot_bak_/.test(k));
  assert.equal(txKeys.length, 1);
  assert.equal(fsText(fs, txKeys[0]), "OLD");
  assert.notEqual(fsText(fs, "EDA6.py"), "NEW");
  await s.close();
});

test("installFile: commit never removes generic __pybot_bak before verified final", async () => {
  const { s, hooks } = await installSession({ "x.py": "1", "x.py.__pybot_bak": "KEEP" });
  await s.installFile("x.py", "22");
  const commit = hooks.scripts.find((c) => /backup_made/.test(c));
  assert.ok(commit);
  assert.doesNotMatch(commit, /remove\('x\.py\.__pybot_bak'\)/);
  assert.doesNotMatch(commit, /_rm\('x\.py\.__pybot_bak'\)/);
  // Solo el TX bak (con nonce) puede borrarse tras éxito.
  assert.match(commit, /if backup_made:\s*\n\s*_rm\(B\)/m);
  await s.close();
});

test("installFile: structural guards (no full read, temp suffixes, no version/firmware touch)", async () => {
  const src = readFileSync(
    new URL("../src/micropython/micropythonSession.js", import.meta.url),
    "utf8",
  );
  const fn = src.slice(src.indexOf("async installFile("), src.indexOf("async syncFilesystem("));
  assert.match(fn, /\.__pybot_tmp/);
  assert.match(fn, /\.__pybot_bak_/);
  assert.match(fn, /backup_made/);
  assert.match(fn, /os\.stat\(p\)\[6\]/);
  assert.doesNotMatch(fn, /open\([^)]+\)\.read\(/);
  assert.doesNotMatch(fn, /\.read\(\)/);
  assert.match(fn, /CHUNK = 1024/);
  assert.match(fn, /bytes\.length/);

  const { s, hooks } = await installSession({ "x.py": "1" });
  await s.installFile("x.py", "22");
  const joined = hooks.scripts.join("\n");
  assert.doesNotMatch(joined, /open\([^)]*\)\.read\(/);
  assert.match(joined, /__pybot_tmp/);
  assert.match(joined, /__pybot_bak_/);
  await s.close();

  // No tocar fixes recientes de firmware/version en este cambio.
  const ble = readFileSync(
    new URL("../firmware/pybot-ble-runtime/pybot_ble.py", import.meta.url),
    "utf8",
  );
  assert.match(ble, /PYBOT_RUNTIME_VERSION = "4\.0\.6"/);
  assert.match(ble, /BUILTIN_LED_PIN = None/);
});
