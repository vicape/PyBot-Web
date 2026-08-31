import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODE } from "../src/examplesData.js";
import {
  ACTIVITY_ID_QUERY,
  parseActivityId,
  pickActivityEditorCode,
  resolveActivityEditorCode,
} from "../src/platform/activityIdeSession.js";
import {
  readActivityLaunchCache,
  writeActivityLaunchCache,
} from "../src/platform/courseActivityApi.js";

test("parseActivityId lee el query param actividad", () => {
  const params = new URLSearchParams("actividad=abc-123&foo=1");
  assert.equal(parseActivityId(params), "abc-123");
  assert.equal(ACTIVITY_ID_QUERY, "actividad");
});

test("resolveActivityEditorCode prioriza launchCode", () => {
  assert.equal(
    resolveActivityEditorCode({
      starterCode: "starter",
      savedCode: "saved",
      launchCode: "launch",
    }),
    "launch",
  );
});

test("resolveActivityEditorCode ignora guardado genérico si hay starter", () => {
  assert.equal(
    resolveActivityEditorCode({
      starterCode: "print('tarea')",
      savedCode: DEFAULT_CODE,
      launchCode: "",
    }),
    "print('tarea')",
  );
});

test("pickActivityEditorCode usa starter si no hay guardado", () => {
  assert.equal(pickActivityEditorCode("starter", "", "fallback"), "starter");
  assert.equal(pickActivityEditorCode("starter", null, "fallback"), "starter");
});

test("launch cache escribe y lee código por actividad", () => {
  const store = new Map();
  global.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };

  writeActivityLaunchCache("act-1", 'print("hola")');
  assert.equal(readActivityLaunchCache("act-1"), 'print("hola")');
  assert.equal(readActivityLaunchCache("act-2"), null);
});
