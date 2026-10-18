/**
 * C6-only chunked binary asset transfer over the active lab WebSerial REPL.
 *
 * Board-scoped path: does not call the shared legacy text installer API.
 * Does NOT call navigator.serial.requestPort — uses the existing session.
 * Temp → length+checksum verify → rename; failure cleans only task-owned .tmp.
 */

import {
  checksumSum32,
  MAX_ASSET_BYTES,
  MAX_FULLSCREEN_BYTES,
} from "../graphics/rgb565.js";

export const C6_ASSET_DIR = "pybot/assets";
export const C6_ASSET_MANIFEST = "pybot/assets/manifest.json";
export const C6_ASSET_CHUNK_B64 = 768;
/** Absolute transfer ceiling = full-screen PBI (icon profile stays ≤ MAX_ASSET_BYTES). */
export const C6_ASSET_MAX_BYTES = MAX_FULLSCREEN_BYTES;
/** Icon-profile soft cap (documented / tests). */
export const C6_ASSET_ICON_MAX_BYTES = MAX_ASSET_BYTES;

/**
 * @param {string} path
 */
function esc(path) {
  return String(path).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * @param {{ stdout?: string, stderr?: string }} result
 * @param {string} marker
 */
function hasMarker(result, marker) {
  return String(result?.stdout ?? "").includes(marker);
}

/**
 * Ensure pybot/assets exists (idempotent). Requires existing /pybot.
 * @param {{ execRaw: Function }} session
 */
export async function ensureC6AssetDir(session) {
  if (!session || typeof session.execRaw !== "function") {
    throw new Error("C6_ASSET_NO_SESSION");
  }
  const script = [
    "import os",
    "try:",
    "    os.stat('pybot')",
    "except OSError:",
    "    print('C6_ASSET_NO_PYBOT')",
    "    raise OSError('no pybot')",
    "try:",
    "    os.stat('pybot/assets')",
    "except OSError:",
    "    os.mkdir('pybot/assets')",
    "print('C6_ASSET_DIR_OK')",
  ].join("\n");
  const r = await session.execRaw(script, { timeout: 8000 });
  if (!hasMarker(r, "C6_ASSET_DIR_OK")) {
    throw new Error(
      `C6_ASSET_DIR_FAIL:${String(r?.stdout || r?.stderr || "").slice(0, 120)}`,
    );
  }
}

/**
 * Query free/used-ish FS size via os.statvfs when available.
 * @param {{ execRaw: Function }} session
 * @returns {Promise<{ free: number, total: number }>}
 */
export async function probeC6FilesystemSpace(session) {
  const script = [
    "import os",
    "try:",
    "    v=os.statvfs('/')",
    "    print('C6_FS', v[0]*v[3], v[0]*v[2])",
    "except Exception as e:",
    "    print('C6_FS', -1, -1)",
  ].join("\n");
  const r = await session.execRaw(script, { timeout: 8000 });
  const m = String(r?.stdout ?? "").match(/C6_FS\s+(-?\d+)\s+(-?\d+)/);
  if (!m) return { free: -1, total: -1 };
  return { free: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

/**
 * Bytes → base64 without Buffer (browser + node).
 * @param {Uint8Array} bytes
 */
export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Transfer binary bytes to boardPath via temp + checksum + rename.
 *
 * @param {{ execRaw: Function }} session
 * @param {string} boardPath final path e.g. pybot/assets/logo.pbi
 * @param {Uint8Array} bytes
 * @param {{
 *   onProgress?: (info: { done: number, total: number, pct: number }) => void,
 *   originalName?: string,
 *   maxBytes?: number,
 * }} [options]
 */
export async function transferC6BinaryAsset(session, boardPath, bytes, options = {}) {
  if (!session || typeof session.execRaw !== "function") {
    throw new Error("C6_ASSET_NO_SESSION");
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("C6_ASSET_NOT_BYTES");
  }
  const maxBytes = options.maxBytes ?? C6_ASSET_MAX_BYTES;
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(`C6_ASSET_SIZE:${bytes.length}`);
  }

  await ensureC6AssetDir(session);

  const space = await probeC6FilesystemSpace(session);
  if (space.free >= 0 && space.free < bytes.length + 512) {
    throw new Error(`C6_ASSET_FS_FULL:free=${space.free}:need=${bytes.length}`);
  }

  const finalPath = String(boardPath);
  if (
    finalPath.includes("..") ||
    finalPath.startsWith("/") ||
    !finalPath.startsWith("pybot/assets/")
  ) {
    throw new Error("C6_ASSET_PATH_REJECT");
  }
  // Never allow overwriting main.py via this API
  if (finalPath === "main.py" || finalPath.endsWith("/main.py")) {
    throw new Error("C6_ASSET_PATH_REJECT_MAIN");
  }

  const tmpPath = `${finalPath}.tmp`;
  const safeFinal = esc(finalPath);
  const safeTmp = esc(tmpPath);
  const expected = bytes.length;
  const expectCs = checksumSum32(bytes);

  // Create/truncate temp only
  {
    const r = await session.execRaw(
      [
        "import os",
        "try:",
        `    os.remove('${safeTmp}')`,
        "except OSError:",
        "    pass",
        `with open('${safeTmp}', 'wb') as f:`,
        "    pass",
        "print('C6_ASSET_TMP_OK')",
      ].join("\n"),
      { timeout: 8000 },
    );
    if (!hasMarker(r, "C6_ASSET_TMP_OK")) {
      throw new Error("C6_ASSET_TMP_FAIL");
    }
  }

  const b64 = bytesToBase64(bytes);
  const chunk = C6_ASSET_CHUNK_B64;
  let done = 0;
  try {
    for (let i = 0; i < b64.length; i += chunk) {
      const part = b64.slice(i, i + chunk);
      const safeChunk = part.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const r = await session.execRaw(
        [
          "import ubinascii",
          `with open('${safeTmp}', 'ab') as f:`,
          `    f.write(ubinascii.a2b_base64('${safeChunk}'))`,
          "print('C6_ASSET_CHUNK_OK')",
        ].join("\n"),
        { timeout: 15000 },
      );
      if (!hasMarker(r, "C6_ASSET_CHUNK_OK")) {
        throw new Error("C6_ASSET_CHUNK_FAIL");
      }
      const pad = part.endsWith("==") ? 2 : part.endsWith("=") ? 1 : 0;
      done = Math.min(
        expected,
        done + Math.floor((part.length * 3) / 4) - pad,
      );
      options.onProgress?.({
        done,
        total: expected,
        pct:
          expected === 0 ? 100 : Math.min(100, Math.round((done / expected) * 100)),
      });
    }
  } catch (e) {
    await cleanupOwnedTemp(session, tmpPath);
    throw e;
  }

  // Verify length + checksum on temp, then rename (replace final only after OK)
  const commit = [
    "import os",
    `T='${safeTmp}'`,
    `F='${safeFinal}'`,
    `E=${expected}`,
    `C=${expectCs}`,
    "def _sz(p):",
    "    return os.stat(p)[6]",
    "def _cs(p):",
    "    s=0",
    "    with open(p,'rb') as f:",
    "        while True:",
    "            b=f.read(512)",
    "            if not b: break",
    "            for x in b: s=(s+x)&0xffffffff",
    "    return s",
    "try:",
    "    if _sz(T)!=E:",
    "        print('C6_ASSET_LEN_FAIL')",
    "        raise OSError('len')",
    "    if _cs(T)!=C:",
    "        print('C6_ASSET_CS_FAIL')",
    "        raise OSError('cs')",
    "    try:",
    "        os.remove(F)",
    "    except OSError:",
    "        pass",
    "    os.rename(T, F)",
    "    if _sz(F)!=E:",
    "        print('C6_ASSET_FINAL_FAIL')",
    "        raise OSError('final')",
    "    print('C6_ASSET_COMMIT_OK')",
    "except Exception as e:",
    "    try:",
    "        os.remove(T)",
    "    except OSError:",
    "        pass",
    "    print('C6_ASSET_COMMIT_FAIL')",
  ].join("\n");

  let commitResult;
  try {
    commitResult = await session.execRaw(commit, { timeout: 20000 });
  } catch (e) {
    await cleanupOwnedTemp(session, tmpPath);
    throw e;
  }

  if (!hasMarker(commitResult, "C6_ASSET_COMMIT_OK")) {
    await cleanupOwnedTemp(session, tmpPath);
    const why = String(commitResult?.stdout || "").includes("C6_ASSET_CS_FAIL")
      ? "checksum"
      : String(commitResult?.stdout || "").includes("C6_ASSET_LEN_FAIL")
        ? "length"
        : "commit";
    throw new Error(`C6_ASSET_VERIFY_FAIL:${why}`);
  }

  if (options.originalName) {
    await updateAssetManifest(session, options.originalName, finalPath);
  }

  return {
    ok: true,
    path: finalPath,
    bytes: expected,
    checksum: expectCs,
  };
}

/**
 * Best-effort remove of task-owned .tmp only (never main.py / unrelated).
 * @param {{ execRaw: Function }} session
 * @param {string} tmpPath
 */
export async function cleanupOwnedTemp(session, tmpPath) {
  if (!tmpPath || !String(tmpPath).endsWith(".tmp")) return;
  if (!String(tmpPath).startsWith("pybot/assets/")) return;
  try {
    await session.execRaw(
      [
        "import os",
        "try:",
        `    os.remove('${esc(tmpPath)}')`,
        "except OSError:",
        "    pass",
        "print('C6_ASSET_TMP_CLEAN')",
      ].join("\n"),
      { timeout: 5000 },
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Merge/replace one alias in manifest.json (tiny JSON object).
 * @param {{ execRaw: Function }} session
 * @param {string} originalName e.g. logo.png
 * @param {string} boardPath e.g. pybot/assets/logo.pbi
 */
export async function updateAssetManifest(session, originalName, boardPath) {
  const base = String(originalName).split(/[/\\]/).pop();
  const safeBase = esc(base);
  const safePath = esc(boardPath);
  const script = [
    "import os",
    `M='${esc(C6_ASSET_MANIFEST)}'`,
    `K='${safeBase}'`,
    `V='${safePath}'`,
    "data={}",
    "try:",
    "    with open(M,'r') as f:",
    "        raw=f.read().strip()",
    "    if raw.startswith('{') and raw.endswith('}'):",
    "        body=raw[1:-1].strip()",
    "        if body:",
    "            for part in body.split(','):",
    "                part=part.strip()",
    "                if not part: continue",
    "                a,b=part.split(':',1)",
    "                data[a.strip().strip('\"')]=b.strip().strip('\"')",
    "except OSError:",
    "    pass",
    "data[K]=V",
    "parts=['\"%s\":\"%s\"'%(k,data[k]) for k in data]",
    "with open(M,'w') as f:",
    "    f.write('{'+','.join(parts)+'}')",
    "print('C6_ASSET_MANIFEST_OK')",
  ].join("\n");
  const r = await session.execRaw(script, { timeout: 8000 });
  if (!hasMarker(r, "C6_ASSET_MANIFEST_OK")) {
    throw new Error("C6_ASSET_MANIFEST_FAIL");
  }
}

/**
 * High-level: convert already-encoded PBI bytes + transfer with replace confirm hook.
 * @param {{ execRaw: Function }} session
 * @param {{
 *   bytes: Uint8Array,
 *   boardPath: string,
 *   originalName: string,
 *   replaceConfirmed?: boolean,
 *   onProgress?: Function,
 *   assetExists?: (path: string) => Promise<boolean>,
 * }} spec
 */
export async function uploadC6ImageAsset(session, spec) {
  const path = spec.boardPath;
  let exists = false;
  if (typeof spec.assetExists === "function") {
    exists = await spec.assetExists(path);
  } else {
    try {
      const r = await session.execRaw(
        [
          "import os",
          "try:",
          `    os.stat('${esc(path)}')`,
          "    print('C6_ASSET_EXISTS')",
          "except OSError:",
          "    print('C6_ASSET_MISSING')",
        ].join("\n"),
        { timeout: 8000 },
      );
      exists = hasMarker(r, "C6_ASSET_EXISTS");
    } catch {
      exists = false;
    }
  }
  if (exists && !spec.replaceConfirmed) {
    const err = new Error("C6_ASSET_REPLACE_REQUIRED");
    err.code = "C6_ASSET_REPLACE_REQUIRED";
    err.path = path;
    throw err;
  }
  return transferC6BinaryAsset(session, path, spec.bytes, {
    onProgress: spec.onProgress,
    originalName: spec.originalName,
  });
}
