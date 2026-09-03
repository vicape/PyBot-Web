import { useEffect, useMemo, useRef, useState } from "react";
import { getPybotSlashMenuItems } from "./pybotContentSchema.jsx";

function ensureEditableCursor(editor) {
  editor.focus();
  try {
    if (editor.getTextCursorPosition()?.block) return;
  } catch {
    // ignore
  }
  const last = editor.document[editor.document.length - 1];
  if (last) editor.setTextCursorPosition(last, "end");
}

function runInsert(editor, item) {
  if (!item?.onItemClick) return;
  ensureEditableCursor(editor);
  try {
    item.onItemClick();
  } catch {
    const last = editor.document[editor.document.length - 1];
    if (last?.type !== "paragraph") {
      editor.insertBlocks([{ type: "paragraph" }], last, "after");
      editor.setTextCursorPosition(editor.document[editor.document.length - 1], "end");
    } else {
      editor.setTextCursorPosition(last, "end");
    }
    item.onItemClick();
  }
}

function openSlashMenu(editor) {
  ensureEditableCursor(editor);
  const ext = editor.getExtension?.("suggestionMenu");
  if (ext?.openSuggestionMenu) {
    ext.openSuggestionMenu("/", { deleteTriggerCharacter: true, ignoreQueryLength: true });
    return;
  }
  // Fallback: insert "/" so BlockNote opens the native menu.
  try {
    editor.insertInlineContent("/");
  } catch {
    // ignore
  }
}

function findItem(items, title) {
  return items.find((item) => item.title === title);
}

function IconBtn({ label, children, onClick, disabled, tone = "blue" }) {
  return (
    <button
      type="button"
      className={`pbc-vbar__icon-btn pbc-vbar__icon-btn--${tone}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Svg({ children, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

function IconHeading() {
  return (
    <Svg>
      <path d="M6 5v14M18 5v14M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IconText() {
  return (
    <Svg>
      <path d="M5 6h14M12 6v12M9 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconBullet() {
  return (
    <Svg>
      <circle cx="6" cy="7" r="1.6" fill="currentColor" />
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="6" cy="17" r="1.6" fill="currentColor" />
      <path d="M10 7h9M10 12h9M10 17h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IconNumbered() {
  return (
    <Svg>
      <path d="M5 7h2M5 12h2M5 17h2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 7h9M10 12h9M10 17h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IconImage() {
  return (
    <Svg>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.8" fill="currentColor" />
      <path d="M4.5 16.5l4.5-4 3.2 2.8 3-3.3 4.3 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </Svg>
  );
}

function IconVideo() {
  return (
    <Svg>
      <rect x="3.5" y="6" width="12.5" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 9.5l4.5-2.2v9.4L16 14.5V9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </Svg>
  );
}

function IconAudio() {
  return (
    <Svg>
      <path d="M5 10v4M9 8v8M13 6v12M17 9v6M21 11v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IconFile() {
  return (
    <Svg>
      <path d="M7 3.75h7.5L19 8.25V20a1.25 1.25 0 0 1-1.25 1.25H7A1.25 1.25 0 0 1 5.75 20V5A1.25 1.25 0 0 1 7 3.75Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14.5 3.75V8.5H19" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </Svg>
  );
}

function IconTable() {
  return (
    <Svg>
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16M4 14h16M10 5v14M14 5v14" stroke="currentColor" strokeWidth="1.6" />
    </Svg>
  );
}

function IconCode() {
  return (
    <Svg size={22}>
      <path d="M9 7L4.5 12 9 17M15 7l4.5 5L15 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconExercise() {
  return (
    <Svg>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 12h7M12 8.5v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function IconTask() {
  return (
    <Svg>
      <path d="M8.5 4.75h7A1.75 1.75 0 0 1 17.25 6.5v12.75L12 16.5l-5.25 2.75V6.5A1.75 1.75 0 0 1 8.5 4.75Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </Svg>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="22" viewBox="0 0 14 22" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="1.5" fill="#94A3B8" />
      <circle cx="10" cy="4" r="1.5" fill="#94A3B8" />
      <circle cx="4" cy="11" r="1.5" fill="#94A3B8" />
      <circle cx="10" cy="11" r="1.5" fill="#94A3B8" />
      <circle cx="4" cy="18" r="1.5" fill="#94A3B8" />
      <circle cx="10" cy="18" r="1.5" fill="#94A3B8" />
    </svg>
  );
}

export default function LessonInsertToolbar({ editor, disabled = false }) {
  const [textMenuOpen, setTextMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const items = useMemo(() => getPybotSlashMenuItems(editor), [editor]);

  useEffect(() => {
    if (!textMenuOpen) return undefined;
    const onDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setTextMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [textMenuOpen]);

  const heading1 = findItem(items, "Título 1");
  const heading2 = findItem(items, "Título 2");
  const heading3 = findItem(items, "Título 3");
  const text = findItem(items, "Texto");
  const bullet = findItem(items, "Lista");
  const numbered = findItem(items, "Lista numerada");
  const quote = findItem(items, "Cita");
  const divider = findItem(items, "Separador");
  const image = findItem(items, "Imagen");
  const video = findItem(items, "Video");
  const audio = findItem(items, "Audio");
  const file = findItem(items, "Archivo");
  const table = findItem(items, "Tabla");
  const code = findItem(items, "Código");
  const exercise = findItem(items, "Ejercicio");
  const task = findItem(items, "Tarea");

  const insert = (item) => {
    setTextMenuOpen(false);
    runInsert(editor, item);
  };

  return (
    <div className="pbc-vbar" role="toolbar" aria-label="Herramientas del editor">
      <div className="pbc-vbar__start">
        <span className="pbc-vbar__grip" aria-hidden>
          <GripIcon />
        </span>
        <button
          type="button"
          className="pbc-vbar__plus"
          title="Insertar contenido"
          aria-label="Insertar contenido"
          disabled={disabled}
          onClick={() => openSlashMenu(editor)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="pbc-vbar__divider" aria-hidden />

      <div className="pbc-vbar__group" role="group" aria-label="Texto" ref={menuRef}>
        <IconBtn label="Título" disabled={disabled} onClick={() => insert(heading1)}>
          <IconHeading />
        </IconBtn>
        <IconBtn label="Texto" disabled={disabled} onClick={() => insert(text)}>
          <IconText />
        </IconBtn>
        <IconBtn label="Lista" disabled={disabled} onClick={() => insert(bullet)}>
          <IconBullet />
        </IconBtn>
        <IconBtn label="Lista numerada" disabled={disabled} onClick={() => insert(numbered)}>
          <IconNumbered />
        </IconBtn>
        <button
          type="button"
          className="pbc-vbar__more"
          title="Más opciones de texto"
          aria-label="Más opciones de texto"
          aria-expanded={textMenuOpen}
          disabled={disabled}
          onClick={() => setTextMenuOpen((v) => !v)}
        >
          <span className="pbc-vbar__dot" aria-hidden />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {textMenuOpen ? (
          <div className="pbc-vbar__menu" role="menu">
            {[
              { item: heading1, label: "Título 1" },
              { item: heading2, label: "Título 2" },
              { item: heading3, label: "Título 3" },
              { item: quote, label: "Cita" },
              { item: divider, label: "Separador" },
            ].map(({ item, label }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                className="pbc-vbar__menu-item"
                disabled={disabled || !item}
                onClick={() => insert(item)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="pbc-vbar__divider" aria-hidden />

      <div className="pbc-vbar__group" role="group" aria-label="Multimedia">
        <IconBtn label="Imagen" tone="cyan" disabled={disabled} onClick={() => insert(image)}>
          <IconImage />
        </IconBtn>
        <IconBtn label="Video" tone="cyan" disabled={disabled} onClick={() => insert(video)}>
          <IconVideo />
        </IconBtn>
        <IconBtn label="Audio" tone="cyan" disabled={disabled} onClick={() => insert(audio)}>
          <IconAudio />
        </IconBtn>
        <IconBtn label="Archivo" tone="cyan" disabled={disabled} onClick={() => insert(file)}>
          <IconFile />
        </IconBtn>
        <IconBtn label="Tabla" tone="cyan" disabled={disabled} onClick={() => insert(table)}>
          <IconTable />
        </IconBtn>
      </div>

      <div className="pbc-vbar__divider" aria-hidden />

      <div className="pbc-vbar__group" role="group" aria-label="Código">
        <IconBtn label="Código" tone="violet" disabled={disabled} onClick={() => insert(code)}>
          <IconCode />
        </IconBtn>
      </div>

      <div className="pbc-vbar__divider" aria-hidden />

      <div className="pbc-vbar__group" role="group" aria-label="PyBotClass">
        <IconBtn label="Ejercicio" tone="violet" disabled={disabled} onClick={() => insert(exercise)}>
          <IconExercise />
        </IconBtn>
        <IconBtn label="Tarea" tone="violet" disabled={disabled} onClick={() => insert(task)}>
          <IconTask />
        </IconBtn>
      </div>
    </div>
  );
}
