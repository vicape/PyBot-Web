import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fieldsSrc = readFileSync(
  resolve(root, "src/components/pybotclass/content/ContentMetadataFields.jsx"),
  "utf8",
);
const createSrc = readFileSync(
  resolve(root, "src/components/pybotclass/content/CreateContentModal.jsx"),
  "utf8",
);
const editSrc = readFileSync(
  resolve(root, "src/components/pybotclass/content/EditContentModal.jsx"),
  "utf8",
);

const LIST_FIELDS = ["tags", "learning_objectives", "prerequisites"];

/** Load the real listToText implementation from the component source (node cannot import .jsx). */
function loadListToText() {
  const match = fieldsSrc.match(
    /export function listToText\s*\(\s*value\s*\)\s*\{[\s\S]*?\n\}/,
  );
  assert.ok(match, "listToText export must exist in ContentMetadataFields.jsx");
  return new Function(`${match[0].replace(/^export\s+/, "")}; return listToText;`)();
}

const listToText = loadListToText();

test("listToText: string remains visible; array renders comma-separated", () => {
  assert.equal(listToText("alpha, beta"), "alpha, beta");
  assert.equal(listToText(["alpha", "beta"]), "alpha, beta");
  assert.equal(listToText(null), "");
  assert.equal(listToText(undefined), "");
  assert.equal(listToText(42), "");
});

test("controlled list fields do not collapse to blank after onChange", () => {
  for (const field of LIST_FIELDS) {
    assert.match(fieldsSrc, new RegExp(`value=\\{listToText\\(v\\.${field}\\)\\}`));
    assert.match(
      fieldsSrc,
      new RegExp(`onChange=\\{\\(e\\) => set\\(\\{ ${field}: e\\.target\\.value \\}\\)\\}`),
    );

    const meta = { [field]: ["one", "two"] };
    assert.equal(listToText(meta[field]), "one, two");

    // Existing onChange behavior: assign e.target.value as live string
    const typed = "one, two, three";
    const next = { ...meta, [field]: typed };
    assert.equal(listToText(next[field]), typed);
    assert.notEqual(listToText(next[field]), "");
  }
});

test("CreateContentModal and EditContentModal use ContentMetadataFields", () => {
  assert.match(createSrc, /ContentMetadataFields/);
  assert.match(editSrc, /ContentMetadataFields/);
});
