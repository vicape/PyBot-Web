/**
 * Read-only Markdown fence → BlockNote codeBlock normalization.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  classifyFenceLine,
  extractPlainText,
  normalizeReadOnlyFencedCode,
  parseSupportedFenceSegments,
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

test("AC fence: classifier distinguishes not-a-fence / supported / unsupported / bare", () => {
  assert.deepEqual(classifyFenceLine("hello"), { kind: "not-a-fence" });
  assert.deepEqual(classifyFenceLine("```"), {
    kind: "bare-fence",
    language: "text",
  });
  assert.deepEqual(classifyFenceLine("```python"), {
    kind: "supported-open",
    language: "python",
  });
  assert.deepEqual(classifyFenceLine("```text"), {
    kind: "supported-open",
    language: "text",
  });
  assert.deepEqual(classifyFenceLine("```javascript"), {
    kind: "unsupported-open",
    token: "javascript",
  });
  assert.deepEqual(classifyFenceLine("```html"), {
    kind: "unsupported-open",
    token: "html",
  });
});

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

test("AC fence: single-paragraph complete ```text fence → codeBlock(language=text)", () => {
  const input = [para("```text\nThe variable is called:\nx\n```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    type: "codeBlock",
    props: { language: "text" },
    content: "The variable is called:\nx",
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

test("AC fence: multi-paragraph ```text open/body/close → codeBlock(language=text)", () => {
  const input = [
    para("```text"),
    para("plain line"),
    para("```"),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "plain line",
    },
  ]);
});

test("AC fence: multi-paragraph unlabeled open/body/close → codeBlock(language=text)", () => {
  const input = [para("```"), para("plain code"), para("```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "plain code",
    },
  ]);
});

test("AC fence: supported fence followed by unsupported opening fence does not swallow", () => {
  // Prior bug: ```javascript returned null from isOpenFenceOnly and was
  // treated as body of the python fence until a later ```.
  const input = [
    para("```python"),
    para("print(1)"),
    para("```javascript"),
    para("console.log(1)"),
    para("```"),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  // Ambiguous: python sequence aborted at nested open → originals kept;
  // javascript remains unsupported → unchanged.
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
  assert.equal(out[2], input[2]);
});

test("AC fence: supported fence followed by text opening fence does not swallow", () => {
  const input = [
    para("```python"),
    para("print(1)"),
    para("```text"),
    para("note"),
    para("```"),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  // Incomplete python run kept; ```text + note + ``` normalizes to codeBlock.
  assert.equal(out.length, 3);
  assert.equal(out[0], input[0]);
  assert.equal(out[1], input[1]);
  assert.deepEqual(out[2], {
    type: "codeBlock",
    props: { language: "text" },
    content: "note",
  });
});

test("AC fence: prose before/after fenced blocks remains separate", () => {
  const input = [
    para("The variable is called:"),
    para("```python"),
    para("name = 1"),
    para("```"),
    para("Use it carefully."),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 3);
  assert.equal(out[0].content, "The variable is called:");
  assert.equal(out[0], input[0]);
  assert.deepEqual(out[1], {
    type: "codeBlock",
    props: { language: "python" },
    content: "name = 1",
  });
  assert.equal(out[2].content, "Use it carefully.");
  assert.equal(out[2], input[4]);
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

test("AC fence: multi-paragraph unsupported language left unchanged", () => {
  const input = [
    para("```html"),
    para("<div>x</div>"),
    para("```"),
  ];
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

test("AC mixed: prose + ```python fence + prose → paragraph/codeBlock/paragraph", () => {
  const input = [
    para('Write:\n```python\nprint("Hello")\n```\nRun the program.'),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    { type: "paragraph", content: "Write:" },
    {
      type: "codeBlock",
      props: { language: "python" },
      content: 'print("Hello")',
    },
    { type: "paragraph", content: "Run the program." },
  ]);
});

test("AC mixed: prose + ```text fence + prose splits correctly", () => {
  const input = [
    para(
      "You may have seen something similar to this in a visual programming environment:\n```text\nwhen program starts\nrepeat 3 times\nturn LED on\n```\nThe same idea could be represented using Python:",
    ),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 3);
  assert.equal(
    out[0].content,
    "You may have seen something similar to this in a visual programming environment:",
  );
  assert.deepEqual(out[1], {
    type: "codeBlock",
    props: { language: "text" },
    content: "when program starts\nrepeat 3 times\nturn LED on",
  });
  assert.equal(
    out[2].content,
    "The same idea could be represented using Python:",
  );
});

test("AC mixed: multiple supported fences in one paragraph", () => {
  const input = [
    para(
      'Intro text\n```text\nline 1\nline 2\n```\nMiddle prose\n```python\nprint("x")\n```\nTrailing prose',
    ),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    { type: "paragraph", content: "Intro text" },
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "line 1\nline 2",
    },
    { type: "paragraph", content: "Middle prose" },
    {
      type: "codeBlock",
      props: { language: "python" },
      content: 'print("x")',
    },
    { type: "paragraph", content: "Trailing prose" },
  ]);
});

test("AC mixed: Python indentation and newlines preserved in code", () => {
  const input = [
    para(
      "The same idea could be represented using Python:\n```python\nfor i in range(3):\n    LED_ON\n    wait(1)\n```\nDone.",
    ),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 3);
  assert.equal(
    out[1].content,
    "for i in range(3):\n    LED_ON\n    wait(1)",
  );
  assert.equal(out[0].content, "The same idea could be represented using Python:");
  assert.equal(out[2].content, "Done.");
});

test("AC mixed: surrounding prose preserved exactly in order", () => {
  const input = [
    para('Write:\n```python\nx = 1\n```\nRun the program.'),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out[0].content, "Write:");
  assert.equal(out[2].content, "Run the program.");
});

test("AC mixed: BlockNote newline-in-text serialization extracted losslessly", () => {
  // Confirmed BlockNote shape: hardBreak folds into "\n" inside text nodes.
  const block = {
    type: "paragraph",
    content: [
      { type: "text", text: "Write:\n```python\n", styles: {} },
      { type: "text", text: 'print("Hi")\n```\n', styles: {} },
      { type: "text", text: "Run.", styles: {} },
    ],
  };
  const plain = extractPlainText(block);
  assert.equal(plain, 'Write:\n```python\nprint("Hi")\n```\nRun.');
  const out = normalizeReadOnlyFencedCode([block]);
  assert.deepEqual(out, [
    { type: "paragraph", content: "Write:" },
    {
      type: "codeBlock",
      props: { language: "python" },
      content: 'print("Hi")',
    },
    { type: "paragraph", content: "Run." },
  ]);
});

test("AC mixed: unsupported labeled fence leaves entire paragraph unchanged", () => {
  const input = [
    para("Before\n```javascript\nconsole.log(1)\n```\nAfter"),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC mixed: unmatched incomplete fence leaves paragraph unchanged", () => {
  const input = [para("Before\n```python\nprint(1)\nstill open")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC mixed: rich inline (link) paragraph left unchanged", () => {
  const withLink = {
    type: "paragraph",
    content: [
      { type: "text", text: "See ", styles: {} },
      {
        type: "link",
        href: "https://x",
        content: [{ type: "text", text: "docs", styles: {} }],
      },
      { type: "text", text: "\n```python\nprint(1)\n```\nEnd", styles: {} },
    ],
  };
  assert.equal(extractPlainText(withLink), null);
  assert.deepEqual(normalizeReadOnlyFencedCode([withLink]), [withLink]);
});

test("AC mixed: does not mutate input when splitting mixed paragraph", () => {
  const input = [
    para('Write:\n```python\nprint("x")\n```\nRun.'),
  ];
  const snapshot = structuredClone(input);
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(input, snapshot);
  assert.equal(out.length, 3);
  assert.notEqual(out, input);
});

test("AC mixed: parseSupportedFenceSegments returns null without fences", () => {
  assert.equal(parseSupportedFenceSegments("just prose"), null);
  assert.equal(parseSupportedFenceSegments("use `print()` inline"), null);
});
