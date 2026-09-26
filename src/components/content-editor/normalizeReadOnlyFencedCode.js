/**
 * Read-only normalization: turn unambiguous Markdown fenced-code text into
 * native BlockNote `codeBlock` nodes for rendering only.
 *
 * Does NOT mutate the input document / persisted lesson JSON.
 * Only empty/`text` or `python` fence tokens are accepted; other langs are left as-is.
 *
 * BlockNote's default codeBlock language id is `"text"` (plain text), so explicit
 * ```text / '''text fences map to language="text".
 *
 * Also splits a single plain-text paragraph that embeds complete supported fences
 * together with surrounding prose (read-only only).
 *
 * Fence delimiters: three backticks (```) or three apostrophes ('''). Opening and
 * closing delimiter types must match. Only complete-line fence syntax is recognized
 * (inline ''' / ``` are never treated as fences).
 */

const BACKTICK_OPEN_RE = /^```([A-Za-z0-9_+-]*)\s*$/;
const APOSTROPHE_OPEN_RE = /^'''([A-Za-z0-9_+-]*)\s*$/;
const BACKTICK_CLOSE_RE = /^```\s*$/;
const APOSTROPHE_CLOSE_RE = /^'''\s*$/;

/**
 * Map a fence language token to a BlockNote codeBlock language id.
 * @returns {"text"|"python"|null} null = unsupported fence token
 */
function mapFenceLanguage(token) {
  if (token == null || token === "") return "text";
  const lower = token.toLowerCase();
  if (lower === "python") return "python";
  if (lower === "text") return "text";
  return null;
}

/**
 * Classify a plain-text paragraph for fence scanning.
 * Distinguishes "not a fence" from "unsupported opening fence" so a later
 * ```text / ```javascript / '''python / etc. cannot be swallowed as body of
 * an earlier fence.
 *
 * Bare ``` / ''' is both an unlabeled open and a close; callers treat it as
 * open at sequence start and as close while collecting a body (same delimiter
 * only).
 *
 * @returns {{ kind: "not-a-fence" }
 *   | { kind: "bare-fence", delimiter: "backtick"|"apostrophe", language: "text" }
 *   | { kind: "supported-open", delimiter: "backtick"|"apostrophe", language: "text"|"python" }
 *   | { kind: "unsupported-open", delimiter: "backtick"|"apostrophe", token: string }}
 */
export function classifyFenceLine(text) {
  if (text == null) return { kind: "not-a-fence" };
  const trimmed = text.trim();

  let delimiter = null;
  let token = "";
  let m = trimmed.match(BACKTICK_OPEN_RE);
  if (m) {
    delimiter = "backtick";
    token = m[1] ?? "";
  } else {
    m = trimmed.match(APOSTROPHE_OPEN_RE);
    if (m) {
      delimiter = "apostrophe";
      token = m[1] ?? "";
    }
  }
  if (delimiter == null) return { kind: "not-a-fence" };

  const closeRe =
    delimiter === "backtick" ? BACKTICK_CLOSE_RE : APOSTROPHE_CLOSE_RE;
  // Bare fence matches open (empty token) and close — keep distinct from labeled opens.
  if (token === "" && closeRe.test(trimmed)) {
    return { kind: "bare-fence", delimiter, language: "text" };
  }
  const language = mapFenceLanguage(token);
  if (language != null) {
    return { kind: "supported-open", delimiter, language };
  }
  return { kind: "unsupported-open", delimiter, token };
}

function hasNoChildren(block) {
  return !Array.isArray(block?.children) || block.children.length === 0;
}

/**
 * Extract plain text from a paragraph-like block.
 * Returns null when content is not unambiguously plain text (links, non-text).
 *
 * BlockNote folds ProseMirror hardBreak nodes into "\n" characters inside
 * styled-text InlineContent on serialization — so lossless line breaks appear
 * as newlines in text nodes (or in a string content value), not as a separate
 * InlineContent type.
 */
export function extractPlainText(block) {
  if (!block || block.type !== "paragraph") return null;
  const content = block.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.length === 0) return "";
  let out = "";
  for (const node of content) {
    if (node == null) return null;
    if (typeof node === "string") {
      out += node;
      continue;
    }
    if (node.type === "text" && typeof node.text === "string") {
      out += node.text;
      continue;
    }
    return null;
  }
  return out;
}

function makeCodeBlock(code, language) {
  return {
    type: "codeBlock",
    props: { language },
    content: code,
  };
}

function makeParagraph(text) {
  return {
    type: "paragraph",
    content: text,
  };
}

/** Drop empty edge lines so we do not emit blank paragraph blocks. */
function trimEmptyEdgeLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

function flushProse(proseLines, out) {
  const trimmed = trimEmptyEdgeLines(proseLines);
  if (trimmed.length === 0) return;
  out.push(makeParagraph(trimmed.join("\n")));
}

/**
 * Line-oriented parser for one plain-text paragraph that may embed complete
 * supported fences among prose. Returns derived blocks, or null to leave the
 * original paragraph unchanged (no fences / ambiguous / unsupported).
 *
 * @param {string} text
 * @returns {Array<object>|null}
 */
export function parseSupportedFenceSegments(text) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  const out = [];
  const proseLines = [];
  let fenceCount = 0;
  let i = 0;

  while (i < lines.length) {
    const lineClass = classifyFenceLine(lines[i]);

    if (lineClass.kind === "unsupported-open") {
      return null;
    }

    if (
      lineClass.kind === "supported-open" ||
      lineClass.kind === "bare-fence"
    ) {
      const language = lineClass.language;
      const delimiter = lineClass.delimiter;
      const codeLines = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const midClass = classifyFenceLine(lines[j]);
        if (midClass.kind === "bare-fence") {
          if (midClass.delimiter !== delimiter) {
            // Mismatched closing delimiter — do not partially transform.
            return null;
          }
          closed = true;
          break;
        }
        if (
          midClass.kind === "supported-open" ||
          midClass.kind === "unsupported-open"
        ) {
          // Nested / overlapping fence — do not partially transform.
          return null;
        }
        codeLines.push(lines[j]);
        j += 1;
      }
      if (!closed) {
        return null;
      }
      flushProse(proseLines, out);
      proseLines.length = 0;
      out.push(makeCodeBlock(codeLines.join("\n"), language));
      fenceCount += 1;
      i = j + 1;
      continue;
    }

    proseLines.push(lines[i]);
    i += 1;
  }

  if (fenceCount === 0) {
    return null;
  }
  flushProse(proseLines, out);
  return out.length > 0 ? out : null;
}

function tryParseSingleFenceBlock(block) {
  if (!hasNoChildren(block)) return null;
  const text = extractPlainText(block);
  if (text == null) return null;
  const trimmed = text
    .replace(/^\uFEFF/, "")
    .replace(/\s+$/, "")
    .replace(/^\s+/, "");
  // Require open + at least one body line + close (same as prior SINGLE_FENCE_RE).
  if (trimmed.split(/\r?\n/).length < 3) return null;
  const segments = parseSupportedFenceSegments(trimmed);
  if (segments == null || segments.length !== 1) return null;
  if (segments[0].type !== "codeBlock") return null;
  return segments[0];
}

/**
 * Mixed prose + complete supported fence(s) inside one plain-text paragraph.
 * @returns {Array<object>|null}
 */
function tryParseMixedFenceParagraph(block) {
  if (!hasNoChildren(block)) return null;
  const text = extractPlainText(block);
  if (text == null) return null;
  return parseSupportedFenceSegments(text);
}

/** Safe recursion ceiling for BlockNote `children` nesting (not a generic walk). */
const MAX_CHILDREN_DEPTH = 64;

/**
 * Sequence-level fence normalization for one sibling block array.
 * Expects nested `children` to already be normalized. Never mutates `blocks`.
 *
 * @param {Array<object>} blocks
 * @returns {Array<object>}
 */
function normalizeSiblingSequences(blocks) {
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    // Pattern 1: single paragraph whose entire text is a complete fence.
    // hasNoChildren: refuse split when the paragraph still has child blocks.
    const single = tryParseSingleFenceBlock(block);
    if (single) {
      out.push(single);
      i += 1;
      continue;
    }

    // Pattern 1b: mixed prose + complete supported fence(s) in one paragraph.
    const mixed = tryParseMixedFenceParagraph(block);
    if (mixed) {
      out.push(...mixed);
      i += 1;
      continue;
    }

    // Pattern 2: open-fence para + one or more plain paras + close-fence para.
    if (block?.type === "paragraph" && hasNoChildren(block)) {
      const openText = extractPlainText(block);
      const openClass = classifyFenceLine(openText);
      const canStart =
        openClass.kind === "supported-open" || openClass.kind === "bare-fence";
      if (canStart) {
        const language = openClass.language;
        const delimiter = openClass.delimiter;
        let j = i + 1;
        const codeParts = [];
        let closed = false;
        while (j < blocks.length) {
          const mid = blocks[j];
          if (mid?.type !== "paragraph" || !hasNoChildren(mid)) break;
          const midText = extractPlainText(mid);
          if (midText == null) break;
          const midClass = classifyFenceLine(midText);
          // Bare fence with the SAME delimiter closes the current sequence.
          if (midClass.kind === "bare-fence") {
            if (midClass.delimiter !== delimiter) {
              // Mismatched delimiter — abort so originals stay unchanged.
              break;
            }
            closed = true;
            break;
          }
          // Any labeled opening fence (supported or not) is a boundary — abort
          // so we never swallow later fences/prose into the current code block.
          if (
            midClass.kind === "supported-open" ||
            midClass.kind === "unsupported-open"
          ) {
            break;
          }
          codeParts.push(midText);
          j += 1;
        }
        if (closed && codeParts.length >= 1) {
          out.push(makeCodeBlock(codeParts.join("\n"), language));
          i = j + 1;
          continue;
        }
        // Incomplete / ambiguous: keep original blocks unchanged.
      }
    }

    out.push(block);
    i += 1;
  }

  return out;
}

/**
 * Shallow-clone a block only when its `children` array actually changed.
 * Does not walk other object/array fields.
 *
 * @param {unknown} block
 * @param {number} depth
 * @returns {unknown}
 */
function normalizeBlockChildren(block, depth) {
  if (block == null || typeof block !== "object") return block;
  if (!Array.isArray(block.children)) return block;
  const nextChildren = normalizeBlockArray(block.children, depth);
  if (nextChildren === block.children) return block;
  return { ...block, children: nextChildren };
}

/**
 * Normalize one BlockNote block-array level:
 * (1) recursively normalize each block's `children`, then
 * (2) apply sequence-level fence normalization to siblings.
 *
 * @param {Array<unknown>} blocks
 * @param {number} depth
 * @returns {Array<unknown>}
 */
function normalizeBlockArray(blocks, depth) {
  if (!Array.isArray(blocks)) return blocks;
  if (depth > MAX_CHILDREN_DEPTH) return blocks;

  let anyChildrenChanged = false;
  const prepared = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const next = normalizeBlockChildren(block, depth + 1);
    if (next !== block) anyChildrenChanged = true;
    prepared[i] = next;
  }

  const sequenced = normalizeSiblingSequences(prepared);

  if (!anyChildrenChanged) {
    let sameAsInput = sequenced.length === blocks.length;
    if (sameAsInput) {
      for (let i = 0; i < blocks.length; i += 1) {
        if (sequenced[i] !== blocks[i]) {
          sameAsInput = false;
          break;
        }
      }
    }
    if (sameAsInput) return blocks;
  }

  return sequenced;
}

/**
 * Derive a render document from lesson `document_json`.
 * Complete unambiguous fences → native codeBlock; everything else unchanged.
 * Recurses only through BlockNote `children` block arrays (not a generic walk).
 * Input array/objects are never mutated.
 *
 * @param {unknown} documentJson
 * @returns {unknown}
 */
export function normalizeReadOnlyFencedCode(documentJson) {
  if (!Array.isArray(documentJson)) return documentJson;
  return normalizeBlockArray(documentJson, 0);
}
