import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SUPPORTED_LANGS, LANG_LABELS, ENTRY_STRINGS } from "../src/i18n/entry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("entry i18n", () => {
  it("exposes five supported languages with labels", () => {
    assert.deepEqual(SUPPORTED_LANGS, ["es", "en", "fr", "pt", "de"]);
    for (const code of SUPPORTED_LANGS) {
      assert.ok(LANG_LABELS[code], `missing label for ${code}`);
      assert.ok(ENTRY_STRINGS[code], `missing strings for ${code}`);
    }
  });

  it("keeps the same entry keys across all languages", () => {
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
    assert.match(login, /entry-eyebrow/);
    assert.match(login, /entryTagline/);
    assert.match(login, /entry-feature__note/);
    assert.match(login, /entryClassroomHint/);
    assert.match(login, /entry-feature--core/);
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
    assert.match(visual, /entry-visual__workspace/);
    assert.match(visual, /entry-visual__cline--active/);
    assert.match(visual, /entry-visual__hw-meta/);
    assert.match(visual, /entry-visual__tab--hw/);
    assert.doesNotMatch(visual, /entry-visual__orbit/);
  });

  it("i18n.js merges entry strings and persists pybot_lang", () => {
    const i18n = readFileSync(join(root, "src/i18n.js"), "utf8");
    assert.match(i18n, /from "\.\/i18n\/entry\.js"/);
    assert.match(i18n, /ENTRY_STRINGS/);
    assert.match(i18n, /pybot_lang/);
    assert.match(i18n, /SUPPORTED_LANGS\.includes/);
  });

  it("mobile landing CSS uses single-screen compact contract", () => {
    const css = readFileSync(join(root, "src/styles/entry-gate.css"), "utf8");
    assert.match(css, /Smartphone: single-screen compact landing/);
    assert.match(css, /\.entry-eyebrow/);
    assert.match(css, /entry-feature--extended/);
    assert.doesNotMatch(css, /Smartphone premium landing V6/);
    assert.doesNotMatch(css, /Smartphone strong landing/);
    // Compact mobile: shell fills available height without forcing 100dvh
    assert.match(
      css,
      /\/\* —— Smartphone: single-screen compact landing —— \*\/\s*@media \(max-width: 640px\) \{[\s\S]*?\.entry-shell \{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;/,
    );
    assert.match(
      css,
      /\/\* —— Smartphone: single-screen compact landing —— \*\/\s*@media \(max-width: 640px\) \{[\s\S]*?\.entry-hero__visual \{[\s\S]*?flex:\s*1 1 auto;/,
    );
    assert.doesNotMatch(css, /min-height:\s*100dvh/);
  });
});
