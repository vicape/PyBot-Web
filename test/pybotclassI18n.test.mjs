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

test("ActivityPage: no hardcoded Spanish UI deny-list outside PYBOTCLASS_STRINGS", () => {
  const src = readFileSync(
    new URL("../src/pages/ActivityPage.jsx", import.meta.url),
    "utf8",
  );
  const denyList = [
    "Detalle",
    "Abrir PyBot",
    "Volver al curso",
    "Actividades",
    "Ventana",
    "Cuenta Google Classroom vinculada",
    "Sin descripción",
    "Las entregas están cerradas",
    "Evaluación cualitativa (sin nota numérica)",
    "Sincronizando…",
    "Sincronizado",
    "No se pudo sincronizar",
    "Publicar en Classroom",
    "Abrir actividad en Classroom",
    "Alumno Classroom",
    "Archivo entregado",
    "Abrir entrega en Classroom",
    "Ver código",
    "Ocultar código",
    "Historial",
    "Guardar borrador",
    "Cualitativa — sin nota numérica",
    "Nota = total servidor (niveles congelados)",
    "Solicitar revisión",
    "Reabrir para este alumno",
    "Reintentar sync Classroom",
    "Calificar ítem",
    "Ver entregas del curso",
    "Configurar",
    "← Mis clases",
    "Mis clases",
  ];
  for (const lit of denyList) {
    // Allow only inside t("…") key names? Deny if the Spanish phrase appears as a
    // JSX/string literal (quoted) or as raw JSX text — not merely as a substring
    // of an i18n key identifier.
    const quoted = new RegExp(`["'\`]${lit.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["'\`]`);
    const jsxText = new RegExp(`>\\s*${lit.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*<`);
    assert.equal(quoted.test(src), false, `deny-list quoted literal present: ${lit}`);
    assert.equal(jsxText.test(src), false, `deny-list JSX text present: ${lit}`);
  }
  // Core teacher/student actions must go through i18n keys.
  for (const key of [
    "pcDetail",
    "pcOpenPyBot",
    "pcBackToCourse",
    "pcMyClassesBack",
    "pcSyncing",
    "pcSynced",
    "pcRequestReview",
    "pcEvaluate",
    "pcOpenSubmissionInClassroom",
    "pcShowCode",
  ]) {
    assert.match(src, new RegExp(`t\\("${key}"\\)`), `missing i18n usage: ${key}`);
  }
  // pcConfigure lives in compact EvaluationSection (imported by ActivityPage).
  const evalSrc = readFileSync(
    new URL("../src/components/pybotclass/ActivityEvaluationSection.jsx", import.meta.url),
    "utf8",
  );
  assert.match(evalSrc, /t\("pcConfigure"\)/);
});
