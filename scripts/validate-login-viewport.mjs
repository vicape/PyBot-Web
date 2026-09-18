#!/usr/bin/env node
/**
 * Validate /login fits each target viewport without scroll and with key UI visible.
 * Usage (after npm run build):
 *   node scripts/validate-login-viewport.mjs
 *
 * Optional: npm i -D playwright-core && npx playwright install chromium
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = 4173;
const LOGIN_URL = `http://${HOST}:${PORT}/login`;

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1366, h: 768 },
  { w: 1280, h: 720 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 430, h: 932 },
  { w: 390, h: 844 },
  { w: 375, h: 812 },
  { w: 360, h: 800 },
  { w: 320, h: 568 },
];

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, HOST);
  });
}

async function waitForUrl(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      // retry
    }
    await delay(400);
  }
  return false;
}

async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    try {
      return await import("playwright");
    } catch {
      return null;
    }
  }
}

async function loadPuppeteer() {
  try {
    return await import("puppeteer-core");
  } catch {
    try {
      return await import("puppeteer");
    } catch {
      return null;
    }
  }
}

const CHECK_SCRIPT = () => {
  const tol = 2;
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const de = document.documentElement;
  const body = document.body;

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return r.top >= -tol && r.left >= -tol && r.bottom <= ih + tol && r.right <= iw + tol;
  };

  const textOk = (el) => !!(el && String(el.textContent || "").trim());

  const issues = [];

  if (de.scrollHeight > ih + tol) {
    issues.push(`documentElement.scrollHeight ${de.scrollHeight} > innerHeight+${tol} (${ih})`);
  }
  if (de.scrollWidth > iw + tol) {
    issues.push(`documentElement.scrollWidth ${de.scrollWidth} > innerWidth+${tol} (${iw})`);
  }
  if (body.scrollHeight > ih + tol) {
    issues.push(`body.scrollHeight ${body.scrollHeight} > innerHeight+${tol} (${ih})`);
  }

  const features = [...document.querySelectorAll(".entry-feature")];
  if (features.length !== 5) {
    issues.push(`expected 5 .entry-feature, found ${features.length}`);
  }
  features.forEach((feat, i) => {
    if (!visible(feat)) {
      const r = feat.getBoundingClientRect();
      issues.push(
        `.entry-feature[${i}] not fully in viewport (top=${r.top.toFixed(1)} bottom=${r.bottom.toFixed(1)} left=${r.left.toFixed(1)} right=${r.right.toFixed(1)})`,
      );
    }
    const icon = feat.querySelector(".entry-feature__icon");
    const name = feat.querySelector(".entry-feature__name");
    const desc = feat.querySelector(".entry-feature__desc");
    if (!icon) issues.push(`.entry-feature[${i}] missing .entry-feature__icon`);
    if (!textOk(name)) issues.push(`.entry-feature[${i}] empty/missing .entry-feature__name`);
    if (!textOk(desc)) issues.push(`.entry-feature[${i}] empty/missing .entry-feature__desc`);
  });

  const required = [
    [".entry-top__logo", document.querySelector(".entry-top__logo")],
    [".entry-lang__select", document.querySelector(".entry-lang__select")],
    [".entry-theme-btn", document.querySelector(".entry-theme-btn")],
    ["#entry-title", document.querySelector("#entry-title")],
    [".entry-lead", document.querySelector(".entry-lead")],
    [".entry-ide-btn", document.querySelector(".entry-ide-btn")],
    [".entry-visual", document.querySelector(".entry-visual")],
    ["#entry-features-title", document.querySelector("#entry-features-title")],
  ];

  for (const [sel, el] of required) {
    if (!visible(el)) issues.push(`${sel} not fully visible`);
  }

  const google =
    document.querySelector(".entry-google-btn") ||
    document.querySelector(".entry-google-wrap") ||
    document.querySelector(".entry-stub-hint");
  if (!visible(google)) {
    issues.push(".entry-google-btn / .entry-google-wrap / stub not fully visible");
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      innerWidth: iw,
      innerHeight: ih,
      scrollHeight: de.scrollHeight,
      scrollWidth: de.scrollWidth,
      bodyScrollHeight: body.scrollHeight,
    },
  };
};

async function runWithPlaywright(pw) {
  const { chromium } = pw;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    try {
      browser = await chromium.launch({
        headless: true,
        channel: "chrome",
      });
    } catch {
      throw err;
    }
  }

  const results = [];
  try {
    for (const { w, h } of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewportSize({ width: w, height: h });
      await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForSelector(".entry-root", { timeout: 30000 });
      await delay(200);
      const result = await page.evaluate(CHECK_SCRIPT);
      results.push({ w, h, ...result });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function runWithPuppeteer(puppeteerMod) {
  const puppeteer = puppeteerMod.default || puppeteerMod;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const results = [];
  try {
    for (const { w, h } of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h });
      await page.goto(LOGIN_URL, { waitUntil: "networkidle0", timeout: 60000 });
      await page.waitForSelector(".entry-root", { timeout: 30000 });
      await delay(200);
      const result = await page.evaluate(CHECK_SCRIPT);
      results.push({ w, h, ...result });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

function startPreview() {
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "preview", "--host", HOST, "--port", String(PORT)],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "none" },
    },
  );
  let log = "";
  child.stdout.on("data", (d) => {
    log += d.toString();
  });
  child.stderr.on("data", (d) => {
    log += d.toString();
  });
  return { child, getLog: () => log };
}

function printTable(results) {
  console.log("\nViewport validation results");
  console.log("| Viewport | Result | Notes |");
  console.log("|----------|--------|-------|");
  for (const r of results) {
    const label = `${r.w}×${r.h}`;
    const status = r.ok ? "PASS" : "FAIL";
    const notes = r.ok ? "—" : (r.issues || []).slice(0, 3).join("; ").replace(/\|/g, "/");
    console.log(`| ${label} | ${status} | ${notes} |`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const r of failed) {
      console.log(`\n${r.w}×${r.h} failures:`);
      for (const issue of r.issues || []) console.log(`  - ${issue}`);
    }
  }
  return failed.length === 0;
}

async function main() {
  const free = await portFree(PORT);
  let preview = null;
  if (free) {
    preview = startPreview();
    const ready = await waitForUrl(LOGIN_URL);
    if (!ready) {
      console.error("vite preview did not become ready on", LOGIN_URL);
      console.error(preview.getLog());
      preview.child.kill("SIGTERM");
      process.exit(1);
    }
  } else {
    console.log(`Port ${PORT} already in use; reusing existing preview.`);
    const ready = await waitForUrl(LOGIN_URL, 5000);
    if (!ready) {
      console.error(`Nothing responding at ${LOGIN_URL}`);
      process.exit(1);
    }
  }

  let results;
  try {
    const pw = await loadPlaywright();
    if (pw) {
      console.log("Using playwright");
      results = await runWithPlaywright(pw);
    } else {
      const pup = await loadPuppeteer();
      if (pup) {
        console.log("Using puppeteer");
        results = await runWithPuppeteer(pup);
      } else {
        console.error(
          "Neither playwright(-core) nor puppeteer available. Install with:\n  npm i -D playwright-core && npx playwright install chromium",
        );
        process.exit(2);
      }
    }
  } finally {
    if (preview) {
      preview.child.kill("SIGTERM");
      try {
        preview.child.kill("SIGKILL");
      } catch {
        //
      }
    }
  }

  const allOk = printTable(results);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
