export const EMPTY_LESSON_DOCUMENT = [{ type: "paragraph", content: "" }];

export function hasSavedLessonDocument(documentJson) {
  return Array.isArray(documentJson) && documentJson.length > 0;
}

export function normalizeLessonDocument(documentJson) {
  if (!Array.isArray(documentJson) || documentJson.length === 0) {
    return EMPTY_LESSON_DOCUMENT;
  }
  return documentJson;
}

function splitParagraphs(text) {
  if (!text || !String(text).trim()) return [];
  return String(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function legacyBlocksToDocument(blocks) {
  const out = [];
  const rows = Array.isArray(blocks) ? [...blocks] : [];
  rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const block of rows) {
    const title = String(block?.title || "").trim();
    const content = String(block?.content || "");
    const starterCode = String(block?.starter_code || "");
    const type = block?.block_type;

    if (type === "theory") {
      if (title) out.push({ type: "heading", props: { level: 2 }, content: title });
      for (const paragraph of splitParagraphs(content)) {
        out.push({ type: "paragraph", content: paragraph });
      }
      continue;
    }

    if (type === "example") {
      if (title) out.push({ type: "heading", props: { level: 3 }, content: title });
      for (const paragraph of splitParagraphs(content)) {
        out.push({ type: "paragraph", content: paragraph });
      }
      if (starterCode.trim()) {
        out.push({
          type: "codeBlock",
          props: { language: "python" },
          content: starterCode,
        });
      }
      continue;
    }

    if (type === "exercise") {
      out.push({
        type: "pybotExercise",
        props: {
          title: title || "Ejercicio",
          instructions: content,
          starterCode,
        },
      });
      continue;
    }

    if (type === "task") {
      out.push({
        type: "pybotTask",
        props: {
          title: title || "Tarea",
          instructions: content,
          starterCode,
        },
      });
    }
  }

  return out.length ? out : EMPTY_LESSON_DOCUMENT;
}
