import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getLang,
  setLang,
  SUPPORTED_LANGS,
  LANG_LABELS,
} from "../src/i18n.js";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";

function restoreProperty(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

function withBrowserEnv({ stored = null, languages = [], language = "" }, fn) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

  const values = new Map();
  if (stored != null) values.set("pybot_lang", stored);
  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const document = { documentElement: { lang: "" } };

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { languages, language },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });

  try {
    return fn({ localStorage, document });
  } finally {
    restoreProperty("navigator", previousNavigator);
    restoreProperty("localStorage", previousStorage);
    restoreProperty("document", previousDocument);
  }
}

test("PyClass i18n: manual preference wins over browser", () => {
  withBrowserEnv({ stored: "de", languages: ["fr-FR"], language: "fr-FR" }, () => {
    assert.equal(getLang(), "de");
  });
});

for (const [browserLang, expected] of [
  ["es-AR", "es"],
  ["en-US", "en"],
  ["fr-FR", "fr"],
  ["pt-BR", "pt"],
  ["de-DE", "de"],
]) {
  test(`PyClass i18n: ${browserLang} maps to ${expected}`, () => {
    withBrowserEnv({ languages: [browserLang], language: browserLang }, () => {
      assert.equal(getLang(), expected);
    });
  });
}

test("PyClass i18n: unsupported browser language falls back to Spanish", () => {
  withBrowserEnv({ languages: ["ja-JP"], language: "ja-JP" }, () => {
    assert.equal(getLang(), "es");
  });
});

test("PyClass i18n: invalid stored value falls through to browser detection", () => {
  withBrowserEnv({ stored: "xx", languages: ["pt-BR"], language: "pt-BR" }, () => {
    assert.equal(getLang(), "pt");
  });
});

test("PyClass i18n: manual selection persists and updates document language", () => {
  withBrowserEnv({ languages: ["es-AR"], language: "es-AR" }, ({ localStorage, document }) => {
    assert.equal(setLang("fr"), "fr");
    assert.equal(localStorage.getItem("pybot_lang"), "fr");
    assert.equal(document.documentElement.lang, "fr");
    assert.equal(getLang(), "fr");
  });
});

test("PyClass i18n: selector uses exactly the five supported languages", () => {
  assert.deepEqual(SUPPORTED_LANGS, ["es", "en", "fr", "pt", "de"]);
  assert.deepEqual(Object.keys(LANG_LABELS).sort(), [...SUPPORTED_LANGS].sort());

  const topbar = readFileSync(
    new URL("../src/components/pybotclass/layout/PyBotClassTopbar.jsx", import.meta.url),
    "utf8",
  );
  assert.match(topbar, /SUPPORTED_LANGS\.map/);
  assert.match(topbar, /LANG_LABELS\[code\]/);
});

test("PyClass i18n: every language exposes the same PyClass keys", () => {
  const expected = Object.keys(PYBOTCLASS_STRINGS.es).sort();
  assert.ok(expected.length > 100);
  for (const lang of SUPPORTED_LANGS) {
    assert.deepEqual(Object.keys(PYBOTCLASS_STRINGS[lang]).sort(), expected, lang);
    for (const key of expected) {
      assert.equal(typeof PYBOTCLASS_STRINGS[lang][key], "string", `${lang}.${key}`);
      assert.ok(PYBOTCLASS_STRINGS[lang][key].length > 0, `${lang}.${key}`);
    }
  }
});
