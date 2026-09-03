import { getPybotSlashMenuItems } from "./pybotContentSchema.jsx";

const GROUP_ORDER = ["Básico", "Multimedia", "Programación", "PyBotClass"];

const GROUP_CLASS = {
  Básico: "pbc-lesson-insert__group--basic",
  Multimedia: "pbc-lesson-insert__group--media",
  Programación: "pbc-lesson-insert__group--code",
  PyBotClass: "pbc-lesson-insert__group--pybot",
};

function ensureEditableCursor(editor) {
  editor.focus();
  try {
    const pos = editor.getTextCursorPosition();
    if (pos?.block) return;
  } catch {
    // ignore and fall through
  }
  const last = editor.document[editor.document.length - 1];
  if (last) editor.setTextCursorPosition(last, "end");
}

function runInsert(editor, item) {
  ensureEditableCursor(editor);
  try {
    item.onItemClick();
  } catch {
    const last = editor.document[editor.document.length - 1];
    if (last?.type !== "paragraph") {
      editor.insertBlocks([{ type: "paragraph" }], last, "after");
      const nextLast = editor.document[editor.document.length - 1];
      editor.setTextCursorPosition(nextLast, "end");
    } else {
      editor.setTextCursorPosition(last, "end");
    }
    item.onItemClick();
  }
}

export default function LessonInsertToolbar({ editor, disabled = false }) {
  const items = getPybotSlashMenuItems(editor);
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  return (
    <div className="pbc-lesson-insert" role="toolbar" aria-label="Herramientas para insertar contenido">
      <div className="pbc-lesson-insert__intro">
        <strong>Insertar</strong>
        <span>Elegí qué agregar. También podés escribir / en el documento.</span>
      </div>

      <div className="pbc-lesson-insert__rail">
        {grouped.map(({ group, items: groupItems }) => (
          <div
            key={group}
            className={`pbc-lesson-insert__group ${GROUP_CLASS[group] || ""}`}
            role="group"
            aria-label={group}
          >
            <span className="pbc-lesson-insert__group-label">{group}</span>
            <div className="pbc-lesson-insert__buttons">
              {groupItems.map((item) => (
                <button
                  key={`${group}-${item.title}`}
                  type="button"
                  className="pbc-lesson-insert__btn"
                  title={item.subtext || item.title}
                  aria-label={item.title}
                  disabled={disabled}
                  onClick={() => runInsert(editor, item)}
                >
                  {item.icon ? <span className="pbc-lesson-insert__icon">{item.icon}</span> : null}
                  <span className="pbc-lesson-insert__label">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
