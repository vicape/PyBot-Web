import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEntryModule() {
  const entryPath = join(root, "src/i18n/entry.js");
  const source = readFileSync(entryPath, "utf8");
  const context = { module: { exports: {} }, exports: {}, console };
  // Convert ESM export to CommonJS-ish eval for node:test without a bundler.
  const cjs = source
    .replace(/export const (\w+)/g, "exports.$1 =")
    .replace(/export \{([^}]+)\}/g, (_, names) =>
      names
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => {
          const [orig, alias] = n.split(/\s+as\s+/).map((s) => s.trim());
          return `exports.${alias || orig} = ${orig};`;
        })
        .join("\n"),
    );
  vm.runInNewContext(cjs, context, { filename: entryPath });
  return context.exports;
}

describe("entry i18n", () => {
  it("exposes five supported languages with labels", () => {
    const { SUPPORTED_LANGS, LANG_LABELS, ENTRY_STRINGS } = loadEntryModule();
    assert.deepEqual(SUPPORTED_LANGS, ["es", "en", "fr", "pt", "de"]);
    for (const code of SUPPORTED_LANGS) {
      assert.ok(LANG_LABELS[code], `missing label for ${code}`);
      assert.ok(ENTRY_STRINGS[code], `missing strings for ${code}`);
    }
  });

  it("keeps the same entry keys across all languages", () => {
    const { SUPPORTED_LANGS, ENTRY_STRINGS } = loadEntryModule();
    const baseKeys = Object.keys(ENTRY_STRINGS.es).sort();
    assert.ok(baseKeys.includes("entryGoogleContinue"));
    assert.ok(baseKeys.includes("entryTitleLine1"));
    assert.ok(baseKeys.includes("entryIdeLink"));
    assert.ok(baseKeys.includes("entryThemeDark"));
    for (const code of SUPPORTED_LANGS) {
      assert.deepEqual(Object.keys(ENTRY_STRINGS[code]).sort(), baseKeys, code);
      for (const key of baseKeys) {
        assert.equal(typeof ENTRY_STRINGS[code][key], "string");
        assert.ok(ENTRY_STRINGS[code][key].length > 0, `${code}.${key}`);
      }
    }
  });
});

describe("entry gate files", () => {
  it("LoginPage uses centralized entry i18n, real logo, and Google mark", () => {
    const login = readFileSync(join(root, "src/pages/LoginPage.jsx"), "utf8");
    assert.match(login, /from "\.\.\/i18n\.js"/);
    assert.match(login, /SUPPORTED_LANGS/);
    assert.match(login, /entry-google-btn/);
    assert.match(login, /GoogleMark/);
    assert.match(login, /signInWithOAuth/);
    assert.match(login, /pybot-logo-full\.svg/);
    assert.match(login, /EntryProductVisual/);
    assert.match(login, /appearanceApi/);
    assert.match(login, /entry-top__logo/);
    assert.doesNotMatch(login, /entry-brand__mark/);
    assert.doesNotMatch(login, /entry-trust/);
    assert.doesNotMatch(login, /PyBotClass/);
    assert.doesNotMatch(login, />\s*PB\s*</);
  });

  it("product visual keeps real APIs and no floating orbit labels", () => {
    const visual = readFileSync(
      join(root, "src/components/entry/EntryProductVisual.jsx"),
      "utf8",
    );
    assert.match(visual, /pin/);
    assert.match(visual, /wait/);
    assert.match(visual, /servo/);
    assert.match(visual, /print/);
    assert.match(visual, /ESP32/);
    assert.match(visual, /entry-visual__panel-head/);
    assert.doesNotMatch(visual, /entry-visual__orbit/);
  });

  it("i18n.js merges entry strings and persists pybot_lang", () => {
    const i18n = readFileSync(join(root, "src/i18n.js"), "utf8");
    assert.match(i18n, /from "\.\/i18n\/entry\.js"/);
    assert.match(i18n, /ENTRY_STRINGS/);
    assert.match(i18n, /pybot_lang/);
    assert.match(i18n, /SUPPORTED_LANGS\.includes/);
  });
});
