/**
 * Read-only Markdown fence → BlockNote codeBlock normalization.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildLessonPreviewDocument,
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
    delimiter: "backtick",
    language: "text",
  });
  assert.deepEqual(classifyFenceLine("```python"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "python",
  });
  assert.deepEqual(classifyFenceLine("```text"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "text",
  });
  assert.deepEqual(classifyFenceLine("```javascript"), {
    kind: "unsupported-open",
    delimiter: "backtick",
    token: "javascript",
  });
  assert.deepEqual(classifyFenceLine("```html"), {
    kind: "unsupported-open",
    delimiter: "backtick",
    token: "html",
  });
  assert.deepEqual(classifyFenceLine("'''"), {
    kind: "bare-fence",
    delimiter: "apostrophe",
    language: "text",
  });
  assert.deepEqual(classifyFenceLine("'''python"), {
    kind: "supported-open",
    delimiter: "apostrophe",
    language: "python",
  });
  assert.deepEqual(classifyFenceLine("'''text"), {
    kind: "supported-open",
    delimiter: "apostrophe",
    language: "text",
  });
  assert.deepEqual(classifyFenceLine("'''javascript"), {
    kind: "unsupported-open",
    delimiter: "apostrophe",
    token: "javascript",
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

test("AC fence: read-only viewers and lesson preview apply normalizer; edit seed stays raw", () => {
  assert.match(viewerSrc, /normalizeReadOnlyFencedCode/);
  assert.match(lessonViewerSrc, /normalizeReadOnlyFencedCode/);
  assert.match(editorSrc, /buildLessonPreviewDocument/);
  // Edit-mode useCreateBlockNote still seeds from persisted initialContent directly.
  assert.match(
    editorSrc,
    /useCreateBlockNote\(\s*\{[\s\S]*?initialContent,?[\s\S]*?\},\s*\[lessonId\]/,
  );
  // Page does not pre-normalize the editable seed (Preview derives its own render doc).
  const pageSrc = readFileSync(
    resolve(root, "src/pages/LessonEditorPage.jsx"),
    "utf8",
  );
  assert.doesNotMatch(pageSrc, /normalizeReadOnlyFencedCode|buildLessonPreviewDocument/);
  assert.match(pageSrc, /initialContent=\{editorSeed\.document\}/);
});

test("AC preview: ```python for-i-in-range fence → native codeBlock; source untouched", () => {
  const source = [para("```python\nfor i in range(5):\n```")];
  const sourceBefore = JSON.parse(JSON.stringify(source));
  const previewDoc = buildLessonPreviewDocument(source);
  assert.deepEqual(source, sourceBefore);
  assert.equal(previewDoc.length, 1);
  assert.equal(previewDoc[0].type, "codeBlock");
  assert.equal(previewDoc[0].props.language, "python");
  assert.equal(previewDoc[0].content, "for i in range(5):");
});

test("AC preview: LessonBlockNoteEditor Preview path uses buildLessonPreviewDocument", () => {
  assert.match(editorSrc, /function LessonPreviewDocument/);
  assert.match(editorSrc, /buildLessonPreviewDocument\(editor\.document\)/);
  assert.match(
    editorSrc,
    /preview\s*&&\s*previewRenderDocument[\s\S]*LessonPreviewDocument/,
  );
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

test("AC nested: python fence sequence inside one level of children → codeBlock", () => {
  // (e.g. nested column.children with paragraphs ```python / print(1) / ``` becomes
  // [{ type: "codeBlock", props: { language: "python" }, content: "print(1)" }])
  const fenceKids = [
    para("```python"),
    para("print(1)"),
    para("```"),
  ];
  const column = {
    type: "column",
    props: { width: 1 },
    children: fenceKids,
  };
  const input = [column];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "column");
  assert.deepEqual(out[0].props, { width: 1 });
  // nested column.children becomes native codeBlock (parent type/props preserved)
  assert.deepEqual(out[0].children, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "print(1)",
    },
  ]);
  assert.notEqual(out[0], column);
  assert.deepEqual(fenceKids, [
    para("```python"),
    para("print(1)"),
    para("```"),
  ]);
});

test("AC nested: text fence sequence inside children → codeBlock(language=text)", () => {
  const column = {
    type: "column",
    children: [para("```text"), para("when program starts"), para("```")],
  };
  const out = normalizeReadOnlyFencedCode([column]);
  assert.deepEqual(out[0].children, [
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "when program starts",
    },
  ]);
});

test("AC nested: supported fences normalize at least two children levels deep", () => {
  // (e.g. nested column.children two levels deep becomes the same codeBlock shape)
  const input = [
    {
      type: "columnList",
      props: { layout: "equal" },
      content: "ignore-me",
      children: [
        {
          type: "column",
          props: { width: 0.5 },
          children: [
            para("```python"),
            para("print(1)"),
            para("```"),
          ],
        },
      ],
    },
  ];
  const snapshot = structuredClone(input);
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(input, snapshot);
  assert.equal(out[0].type, "columnList");
  assert.deepEqual(out[0].props, { layout: "equal" });
  assert.equal(out[0].content, "ignore-me");
  assert.equal(out[0].children[0].type, "column");
  assert.deepEqual(out[0].children[0].props, { width: 0.5 });
  // column.children becomes [{ type: "codeBlock", props: { language: "python" }, content: "print(1)" }]
  assert.deepEqual(out[0].children[0].children, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "print(1)",
    },
  ]);
});

test("AC nested: mixed prose + fence paragraph inside children splits", () => {
  const parent = {
    type: "bulletListItem",
    props: { checked: false },
    children: [
      para('Write:\n```python\nprint("Hello")\n```\nRun the program.'),
    ],
  };
  const out = normalizeReadOnlyFencedCode([parent]);
  assert.equal(out[0].type, "bulletListItem");
  assert.deepEqual(out[0].props, { checked: false });
  assert.deepEqual(out[0].children, [
    { type: "paragraph", content: "Write:" },
    {
      type: "codeBlock",
      props: { language: "python" },
      content: 'print("Hello")',
    },
    { type: "paragraph", content: "Run the program." },
  ]);
});

test("AC nested: parent type/props/content/order preserved; untouched sibling refs kept", () => {
  const untouched = para("Keep me");
  const native = {
    type: "codeBlock",
    props: { language: "python" },
    content: "already()",
  };
  const nestedFenceParent = {
    type: "column",
    props: { width: 1 },
    content: undefined,
    children: [para("```python"), para("x = 1"), para("```")],
  };
  const input = [untouched, nestedFenceParent, native];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 3);
  assert.equal(out[0], untouched);
  assert.equal(out[2], native);
  assert.equal(out[1].type, "column");
  assert.deepEqual(out[1].props, { width: 1 });
  assert.equal(out[1].content, undefined);
  assert.deepEqual(out[1].children[0], {
    type: "codeBlock",
    props: { language: "python" },
    content: "x = 1",
  });
});

test("AC nested: unsupported/unmatched nested fences remain unchanged", () => {
  const unsupported = {
    type: "column",
    children: [
      para("```javascript"),
      para("console.log(1)"),
      para("```"),
    ],
  };
  const unmatched = {
    type: "column",
    children: [para("```python"), para("print(1)"), para("still open")],
  };
  const out = normalizeReadOnlyFencedCode([unsupported, unmatched]);
  assert.equal(out[0], unsupported);
  assert.equal(out[1], unmatched);
  assert.equal(out[0].children, unsupported.children);
  assert.equal(out[1].children, unmatched.children);
});

test("AC nested: nested native codeBlock remains unchanged", () => {
  const native = {
    type: "codeBlock",
    props: { language: "text" },
    content: "when program starts",
  };
  const parent = { type: "column", children: [native] };
  const out = normalizeReadOnlyFencedCode([parent]);
  assert.equal(out[0], parent);
  assert.equal(out[0].children[0], native);
});

test("AC nested: paragraph with non-empty children keeps content; only children normalize", () => {
  const kidFence = [para("```text"), para("body"), para("```")];
  const paragraph = {
    type: "paragraph",
    content: "```python\nprint(1)\n```",
    children: kidFence,
  };
  const snapshot = structuredClone(paragraph);
  const out = normalizeReadOnlyFencedCode([paragraph]);
  assert.deepEqual(paragraph, snapshot);
  assert.equal(out[0].type, "paragraph");
  assert.equal(out[0].content, "```python\nprint(1)\n```");
  assert.deepEqual(out[0].children, [
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "body",
    },
  ]);
  assert.notEqual(out[0], paragraph);
});

test("AC nested: does not mutate root, parents, or children arrays", () => {
  const kids = [para("```python"), para("print(1)"), para("```")];
  const parent = { type: "column", props: { width: 1 }, children: kids };
  const input = [parent];
  const snapshot = structuredClone(input);
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(input, snapshot);
  assert.equal(parent.children, kids);
  assert.notEqual(out, input);
  assert.notEqual(out[0].children, kids);
  assert.equal(out[0].children[0].type, "codeBlock");
});

// --- Apostrophe (''') fence delimiter support ---

test("AC apostrophe: '''python fence → codeBlock(language=python)", () => {
  const input = [para("'''python\nprint(\"Hello\")\nx = 1\n'''")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: 'print("Hello")\nx = 1',
    },
  ]);
});

test("AC apostrophe: '''text fence → codeBlock(language=text)", () => {
  const input = [para("'''text\nplain text\n'''")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "plain text",
    },
  ]);
});

test("AC apostrophe: unlabeled ''' fence → codeBlock(language=text)", () => {
  const input = [paraInline("'''\nplain\n'''")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out[0].type, "codeBlock");
  assert.equal(out[0].props.language, "text");
  assert.equal(out[0].content, "plain");
});

test("AC apostrophe: backtick and apostrophe forms derive the same codeBlock", () => {
  const backtick = normalizeReadOnlyFencedCode([
    para('```python\nprint("Hello")\n```'),
  ]);
  const apostrophe = normalizeReadOnlyFencedCode([
    para("'''python\nprint(\"Hello\")\n'''"),
  ]);
  assert.deepEqual(backtick, apostrophe);
  const btText = normalizeReadOnlyFencedCode([para("```text\nplain text\n```")]);
  const apText = normalizeReadOnlyFencedCode([para("'''text\nplain text\n'''")]);
  assert.deepEqual(btText, apText);
  const btBare = normalizeReadOnlyFencedCode([para("```\nplain\n```")]);
  const apBare = normalizeReadOnlyFencedCode([para("'''\nplain\n'''")]);
  assert.deepEqual(btBare, apBare);
});

test("AC apostrophe: mismatched ```python ... ''' left unchanged", () => {
  const input = [para("```python\nprint(1)\n'''")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC apostrophe: mismatched '''python ... ``` left unchanged", () => {
  const input = [para("'''python\nprint(1)\n```")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC apostrophe: multi-paragraph mismatched delimiters left unchanged", () => {
  const backtickOpenApostropheClose = [
    para("```python"),
    para("print(1)"),
    para("'''"),
  ];
  const apostropheOpenBacktickClose = [
    para("'''python"),
    para("print(1)"),
    para("```"),
  ];
  assert.deepEqual(
    normalizeReadOnlyFencedCode(backtickOpenApostropheClose),
    backtickOpenApostropheClose,
  );
  assert.deepEqual(
    normalizeReadOnlyFencedCode(apostropheOpenBacktickClose),
    apostropheOpenBacktickClose,
  );
});

test("AC apostrophe: inline triple quotes left unchanged", () => {
  const input = [para("Use ''' to make a Python multiline string")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC apostrophe: Python multiline-string-looking prose left unchanged", () => {
  const input = [para("message = '''hello'''")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC apostrophe: mixed prose + '''python fence + prose splits", () => {
  const input = [para("Before\n'''python\nx = 1\n'''\nAfter")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    { type: "paragraph", content: "Before" },
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "x = 1",
    },
    { type: "paragraph", content: "After" },
  ]);
});

test("AC apostrophe: mixed prose + '''text / unlabeled fences split", () => {
  const textOut = normalizeReadOnlyFencedCode([
    para("Before\n'''text\nplain\n'''\nAfter"),
  ]);
  assert.deepEqual(textOut, [
    { type: "paragraph", content: "Before" },
    { type: "codeBlock", props: { language: "text" }, content: "plain" },
    { type: "paragraph", content: "After" },
  ]);
  const bareOut = normalizeReadOnlyFencedCode([
    para("Before\n'''\nplain\n'''\nAfter"),
  ]);
  assert.deepEqual(bareOut, [
    { type: "paragraph", content: "Before" },
    { type: "codeBlock", props: { language: "text" }, content: "plain" },
    { type: "paragraph", content: "After" },
  ]);
});

test("AC apostrophe: multiple complete fences including mixed delimiters", () => {
  const input = [
    para(
      "Intro\n'''text\nline 1\n'''\nMiddle\n```python\nprint(\"x\")\n```\nEnd",
    ),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, [
    { type: "paragraph", content: "Intro" },
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "line 1",
    },
    { type: "paragraph", content: "Middle" },
    {
      type: "codeBlock",
      props: { language: "python" },
      content: 'print("x")',
    },
    { type: "paragraph", content: "End" },
  ]);
});

test("AC apostrophe: nested children '''python sequence → codeBlock", () => {
  const column = {
    type: "column",
    props: { width: 1 },
    children: [para("'''python"), para("print(1)"), para("'''")],
  };
  const out = normalizeReadOnlyFencedCode([column]);
  assert.deepEqual(out[0].children, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "print(1)",
    },
  ]);
  assert.notEqual(out[0], column);
});

test("AC apostrophe: unsupported '''javascript left unchanged", () => {
  const input = [para("'''javascript\nconsole.log(1)\n'''")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
});

test("AC apostrophe: unmatched incomplete '''python left unchanged", () => {
  const input = [para("Before\n'''python\nprint(1)\nstill open")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC apostrophe: does not mutate input document", () => {
  const input = [para("'''python"), para('print("x")'), para("'''")];
  const snapshot = structuredClone(input);
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(input, snapshot);
  assert.equal(out[0].type, "codeBlock");
  assert.notEqual(out, input);
});

test("AC apostrophe: multi-paragraph '''python open/body/close → codeBlock", () => {
  const input = [
    para("Intro"),
    para("'''python"),
    para('print("a")'),
    para("'''"),
    para("Outro"),
  ];
  const out = normalizeReadOnlyFencedCode(input);
  assert.equal(out.length, 3);
  assert.equal(out[0].content, "Intro");
  assert.deepEqual(out[1], {
    type: "codeBlock",
    props: { language: "python" },
    content: 'print("a")',
  });
  assert.equal(out[2].content, "Outro");
});

// --- Optional whitespace between delimiter and language token ---

test("AC whitespace: one space before python (backtick) → codeBlock", () => {
  assert.deepEqual(classifyFenceLine("``` python"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "python",
  });
  const out = normalizeReadOnlyFencedCode([
    para('``` python\nprint("Hi")\n```'),
  ]);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: 'print("Hi")',
    },
  ]);
});

test("AC whitespace: two spaces before python (backtick) → codeBlock", () => {
  assert.deepEqual(classifyFenceLine("```  python"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "python",
  });
  const out = normalizeReadOnlyFencedCode([
    para("```  python\nx = 1\n```"),
  ]);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "x = 1",
    },
  ]);
});

test("AC whitespace: tab before python (backtick) → codeBlock", () => {
  assert.deepEqual(classifyFenceLine("```\tpython"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "python",
  });
  const out = normalizeReadOnlyFencedCode([
    para("```\tpython\nprint(1)\n```"),
  ]);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "print(1)",
    },
  ]);
});

test("AC whitespace: one space before text (backtick) → codeBlock(language=text)", () => {
  assert.deepEqual(classifyFenceLine("``` text"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "text",
  });
  const out = normalizeReadOnlyFencedCode([
    para("``` text\nplain line\n```"),
  ]);
  assert.deepEqual(out, [
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "plain line",
    },
  ]);
});

test("AC whitespace: apostrophe family with space/tab before python/text", () => {
  assert.deepEqual(classifyFenceLine("''' python"), {
    kind: "supported-open",
    delimiter: "apostrophe",
    language: "python",
  });
  assert.deepEqual(classifyFenceLine("'''\tpython"), {
    kind: "supported-open",
    delimiter: "apostrophe",
    language: "python",
  });
  assert.deepEqual(classifyFenceLine("''' text"), {
    kind: "supported-open",
    delimiter: "apostrophe",
    language: "text",
  });
  const pyOut = normalizeReadOnlyFencedCode([
    para("''' python\nprint(1)\n'''"),
  ]);
  assert.deepEqual(pyOut, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "print(1)",
    },
  ]);
  const textOut = normalizeReadOnlyFencedCode([
    para("''' text\nplain\n'''"),
  ]);
  assert.deepEqual(textOut, [
    {
      type: "codeBlock",
      props: { language: "text" },
      content: "plain",
    },
  ]);
});

test("AC whitespace: no-space forms still accepted (both delimiters)", () => {
  assert.deepEqual(classifyFenceLine("```python"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "python",
  });
  assert.deepEqual(classifyFenceLine("```text"), {
    kind: "supported-open",
    delimiter: "backtick",
    language: "text",
  });
  assert.deepEqual(classifyFenceLine("'''python"), {
    kind: "supported-open",
    delimiter: "apostrophe",
    language: "python",
  });
  assert.deepEqual(classifyFenceLine("'''text"), {
    kind: "supported-open",
    delimiter: "apostrophe",
    language: "text",
  });
});

test("AC whitespace: unsupported label with whitespace left unchanged", () => {
  const jsBacktick = [para("``` javascript\nconsole.log(1)\n```")];
  assert.deepEqual(normalizeReadOnlyFencedCode(jsBacktick), jsBacktick);
  assert.deepEqual(classifyFenceLine("``` javascript"), {
    kind: "unsupported-open",
    delimiter: "backtick",
    token: "javascript",
  });
  const jsApostrophe = [para("''' javascript\nconsole.log(1)\n'''")];
  assert.deepEqual(normalizeReadOnlyFencedCode(jsApostrophe), jsApostrophe);
});

test("AC whitespace: inline fence-like text with spaces left unchanged", () => {
  const input = [para("Use ``` python inline or ''' text inline")];
  const out = normalizeReadOnlyFencedCode(input);
  assert.deepEqual(out, input);
  assert.equal(out[0], input[0]);
});

test("AC whitespace: mismatched delimiters with spaced open left unchanged", () => {
  const btOpenApClose = [para("``` python\nprint(1)\n'''")];
  assert.deepEqual(normalizeReadOnlyFencedCode(btOpenApClose), btOpenApClose);
  const apOpenBtClose = [para("''' python\nprint(1)\n```")];
  assert.deepEqual(normalizeReadOnlyFencedCode(apOpenBtClose), apOpenBtClose);
});

test("AC whitespace: mixed prose + spaced ``` python still splits", () => {
  const out = normalizeReadOnlyFencedCode([
    para('Write:\n``` python\nprint("Hi")\n```\nRun.'),
  ]);
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

test("AC whitespace: nested children with spaced open → codeBlock", () => {
  const column = {
    type: "column",
    props: { width: 1 },
    children: [para("``` python"), para("print(1)"), para("```")],
  };
  const out = normalizeReadOnlyFencedCode([column]);
  assert.deepEqual(out[0].children, [
    {
      type: "codeBlock",
      props: { language: "python" },
      content: "print(1)",
    },
  ]);
});
