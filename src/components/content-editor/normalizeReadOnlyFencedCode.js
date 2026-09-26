/**
 * Read-only normalization: turn unambiguous Markdown fenced-code text into
 * native BlockNote `codeBlock` nodes for rendering only.
 *
 * Does NOT mutate the input document / persisted lesson JSON.
 * Only empty or `python` fence tokens are accepted; other langs are left as-is.
 */

const OPEN_FENCE_RE = /^```([A-Za-z0-9_+-]*)\s*$/;
const CLOSE_FENCE_RE = /^```\s*$/;
const SINGLE_FENCE_RE = /^```([A-Za-z0-9_+-]*)\r?\n([\s\S]*?)\r?\n```$/;

/** @returns {"text"|"python"|null} null = unsupported fence token */
function mapFenceLanguage(token) {
  if (token == null || token === "") return "text";
  if (token.toLowerCase() === "python") return "python";
  return null;
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

function isOpenFenceOnly(text) {
  if (text == null) return null;
  const trimmed = text.trim();
  const m = trimmed.match(OPEN_FENCE_RE);
  if (!m) return null;
  return mapFenceLanguage(m[1]);
}

function isCloseFenceOnly(text) {
  if (text == null) return false;
  return CLOSE_FENCE_RE.test(text.trim());
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
      const language = isOpenFenceOnly(openText);
      if (language != null) {
        let j = i + 1;
        const codeParts = [];
        let closed = false;
        while (j < documentJson.length) {
          const mid = documentJson[j];
          if (mid?.type !== "paragraph" || !hasNoChildren(mid)) break;
          const midText = extractPlainText(mid);
          if (midText == null) break;
          if (isCloseFenceOnly(midText)) {
            closed = true;
            break;
          }
          // A nested open fence mid-sequence is ambiguous — abort.
          if (isOpenFenceOnly(midText) != null) break;
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
