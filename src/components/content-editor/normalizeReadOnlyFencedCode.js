/**
 * Read-only normalization: turn unambiguous Markdown fenced-code text into
 * native BlockNote `codeBlock` nodes for rendering only.
 *
 * Does NOT mutate the input document / persisted lesson JSON.
 * Only empty/`text` or `python` fence tokens are accepted; other langs are left as-is.
 *
 * BlockNote's default codeBlock language id is `"text"` (plain text), so explicit
 * ```text fences map to language="text".
 */

const OPEN_FENCE_RE = /^```([A-Za-z0-9_+-]*)\s*$/;
const CLOSE_FENCE_RE = /^```\s*$/;
const SINGLE_FENCE_RE = /^```([A-Za-z0-9_+-]*)\r?\n([\s\S]*?)\r?\n```$/;

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
 * ```text / ```javascript / etc. cannot be swallowed as body of an earlier fence.
 *
 * Bare ``` is both an unlabeled open and a close; callers treat it as open at
 * sequence start and as close while collecting a body.
 *
 * @returns {{ kind: "not-a-fence" }
 *   | { kind: "bare-fence", language: "text" }
 *   | { kind: "supported-open", language: "text"|"python" }
 *   | { kind: "unsupported-open", token: string }}
 */
export function classifyFenceLine(text) {
  if (text == null) return { kind: "not-a-fence" };
  const trimmed = text.trim();
  const m = trimmed.match(OPEN_FENCE_RE);
  if (!m) return { kind: "not-a-fence" };
  const token = m[1] ?? "";
  // Bare ``` matches open (empty token) and close — keep distinct from labeled opens.
  if (token === "" && CLOSE_FENCE_RE.test(trimmed)) {
    return { kind: "bare-fence", language: "text" };
  }
  const language = mapFenceLanguage(token);
  if (language != null) {
    return { kind: "supported-open", language };
  }
  return { kind: "unsupported-open", token };
}

function hasNoChildren(block) {
  return !Array.isArray(block?.children) || block.children.length === 0;
}

/**
 * Extract plain text from a paragraph-like block.
 * Returns null when content is not unambiguously plain text (links, non-text).
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

function tryParseSingleFenceBlock(block) {
  if (!hasNoChildren(block)) return null;
  const text = extractPlainText(block);
  if (text == null) return null;
  const trimmed = text.replace(/^\uFEFF/, "").replace(/\s+$/, "").replace(/^\s+/, "");
  // Prefer exact interior: trim only outer whitespace for matching.
  const match = trimmed.match(SINGLE_FENCE_RE);
  if (!match) return null;
  const language = mapFenceLanguage(match[1]);
  if (language == null) return null;
  return makeCodeBlock(match[2], language);
}

/**
 * Derive a render document from lesson `document_json`.
 * Complete unambiguous fences → native codeBlock; everything else unchanged.
 * Input array/objects are never mutated.
 *
 * @param {unknown} documentJson
 * @returns {unknown}
 */
export function normalizeReadOnlyFencedCode(documentJson) {
  if (!Array.isArray(documentJson)) return documentJson;

  const out = [];
  let i = 0;
  while (i < documentJson.length) {
    const block = documentJson[i];

    // Pattern 1: single paragraph whose entire text is a complete fence.
    const single = tryParseSingleFenceBlock(block);
    if (single) {
      out.push(single);
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
        let j = i + 1;
        const codeParts = [];
        let closed = false;
        while (j < documentJson.length) {
          const mid = documentJson[j];
          if (mid?.type !== "paragraph" || !hasNoChildren(mid)) break;
          const midText = extractPlainText(mid);
          if (midText == null) break;
          const midClass = classifyFenceLine(midText);
          // Bare ``` closes the current sequence (same as original close-first check).
          if (midClass.kind === "bare-fence") {
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
