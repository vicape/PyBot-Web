/**
 * Read-only Markdown fence → BlockNote codeBlock normalization.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  extractPlainText,
  normalizeReadOnlyFencedCode,
} from "../src/components/content-editor/normalizeReadOnlyFencedCode.js";

const root = resolve(import.meta.dirname, "..");
const viewerSrc = readFileSync(
  resolve(root, "src/components/content-editor/AssignedContentSnapshotViewer.jsx"),
  "utf8",
);
const lessonViewerSrc = readFileSync(
  resolve(root, "src/components/content-editor/AssignedLessonViewer.jsx"),
  "utf8",
);
const editorSrc = readFileSync(
  resolve(root, "src/components/content-editor/LessonBlockNoteEditor.jsx"),
  "utf8",
);

function para(text, extra = {}) {
  return { type: "paragraph", content: text, ...extra };
}

function paraInline(text) {
  return {
    type: "paragraph",
    content: [{ type: "text", text, styles: {} }],
  };
}

test("AC fence root cause: native codeBlock distinct from literal fence paragraphs", () => {
  const native = {
    type: "codeBlock",
    props: { language: "python" },
    content: 'print("Hello")',
  };
  const literal = para('```python\nprint("Hello")\n```');

  const fromNative = normalizeReadOnlyFencedCode([native]);
  const fromLiteral = normalizeReadOnlyFencedCode([literal]);

  assert.equal(fromNative[0].type, "codeBlock");
  assert.equal(fromNative[0], native); // unchanged reference for native blocks
  assert.equal(fromLiteral[0].type, "codeBlock");
  assert.equal(fromLiteral[0].props.language, "python");
  assert.equal(fromLiteral[0].content, 'print("Hello")');
  assert.notEqual(literal.type, "codeBlock");
});

test("AC fence: single-paragraph complete ```python fence → codeBlock", () => {
  const input = [para('```python\nprint("Hi")\nx = 1\n```')];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    type: "codeBlock",
    props: { language: "python" },
    content: 'print("Hi")\nx = 1',
  });
});

test("AC fence: unlabeled complete fence defaults language to text", () => {
  const input = [paraInline("```\nplain code\n```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out[0].type, "codeBlock");
  assert.equal(out[0].props.language, "text");
  assert.equal(out[0].content, "plain code");
});

test("AC fence: multi-paragraph open/body/close sequence → one codeBlock", () => {
  const input = [
    para("Intro"),
    para("```python"),
    para('print("a")'),
    para("print(2)"),
    para("```"),
    para("Outro"),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 3);
  assert.equal(out[0].content, "Intro");
  assert.deepEqual(out[1], {
    type: "codeBlock",
    props: { language: "python" },
    content: 'print("a")\nprint(2)',
  });
  assert.equal(out[2].content, "Outro");
});

test("AC fence: unmatched opening fence left unchanged", () => {
  const input = [para("```python"), para("print(1)"), para("still open")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC fence: unmatched closing fence left unchanged", () => {
  const input = [para("print(1)"), para("```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
});

test("AC fence: prose with inline backticks left unchanged", () => {
  const input = [para("Use `print()` for output.")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC fence: unsupported fence language token left unchanged", () => {
  const input = [para("```javascript\nconsole.log(1)\n```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
});

test("AC fence: empty open→close (no body paragraphs) left unchanged", () => {
  const input = [para("```"), para("```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
});

test("AC fence: does not mutate input document", () => {
  const input = [
    para("```python"),
    para('print("x")'),
    para("```"),
  ];
  const snapshot = structuredClone(input);
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(input, snapshot);
  assert.equal(out[0].type, "codeBlock");
  assert.notEqual(out, input);
});

test("AC fence: preserves surrounding non-code blocks and native codeBlocks", () => {
  const native = {
    type: "codeBlock",
    props: { language: "python" },
    content: "already()",
  };
  const heading = { type: "heading", props: { level: 2 }, content: "Section" };
  const input = [heading, native, para("```\nnew()\n```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out[0], heading);
  assert.equal(out[1], native);
  assert.equal(out[2].type, "codeBlock");
  assert.equal(out[2].content, "new()");
});

test("AC fence: extractPlainText rejects link-bearing paragraphs", () => {
  const withLink = {
    type: "paragraph",
    content: [
      { type: "text", text: "```python", styles: {} },
      { type: "link", href: "https://x", content: [{ type: "text", text: "x", styles: {} }] },
    ],
  };
  assert.equal(extractPlainText(withLink), null);
  assert.deepEqual(normalizeReadOnlyFencedCode([withLink]), [withLink]);
});

test("AC fence: read-only viewers apply normalizer; editor does not", () => {
  assert.match(viewerSrc, /normalizeReadOnlyFencedCode/);
  assert.match(lessonViewerSrc, /normalizeReadOnlyFencedCode/);
  assert.doesNotMatch(editorSrc, /normalizeReadOnlyFencedCode/);
});
