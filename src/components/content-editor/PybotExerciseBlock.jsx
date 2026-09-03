import { useEffect, useRef, useState } from "react";

function updateProp(editor, block, key, value) {
  if (!editor.isEditable) return;
  editor.updateBlock(block, { props: { [key]: value } });
}

function PuzzleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 4.5h3.2a2 2 0 0 1 2 2V8h1.8a2.2 2.2 0 1 1 0 4.4H14.2v1.8a2 2 0 0 1-2 2H9.5V14.5a2.2 2.2 0 1 0-4.4 0v1.7H4.5a2 2 0 0 1-2-2V12H4a2.2 2.2 0 1 0 0-4.4H2.5V6.5a2 2 0 0 1 2-2H7V6a2.2 2.2 0 1 0 4.4 0V4.5H9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PybotExerciseBlock({ block, editor }) {
  const editable = editor.isEditable;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const titleId = `${block.id}-exercise-title`;
  const instructionsId = `${block.id}-exercise-instructions`;
  const codeId = `${block.id}-exercise-code`;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div className="pbc-pybot-card pbc-pybot-card--exercise" contentEditable={false}>
      <div className="pbc-pybot-card__top">
        <div className="pbc-pybot-card__identity">
          <span className="pbc-pybot-card__glyph" aria-hidden>
            <PuzzleIcon />
          </span>
          <span className="pbc-pybot-card__kind">Ejercicio</span>
        </div>
        <div className="pbc-pybot-card__meta">
          <span className="pbc-pybot-card__hint">Actividad de programación</span>
          {editable ? (
            <div className="pbc-pybot-card__menu" ref={menuRef}>
              <button
                type="button"
                className="pbc-pybot-card__menu-btn"
                aria-label="Opciones del ejercicio"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="5" r="1.7" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.7" fill="currentColor" />
                  <circle cx="12" cy="19" r="1.7" fill="currentColor" />
                </svg>
              </button>
              {menuOpen ? (
                <div className="pbc-pybot-card__menu-panel" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="pbc-pybot-card__menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      window.dispatchEvent(
                        new CustomEvent("pbc-assign-source", {
                          detail: {
                            sourceType: "exercise",
                            blockId: block.id,
                            blockProps: {
                              title: block.props.title,
                              instructions: block.props.instructions,
                              starterCode: block.props.starterCode,
                            },
                          },
                        }),
                      );
                    }}
                  >
                    Asignar
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="pbc-pybot-card__menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      editor.removeBlocks([block]);
                    }}
                  >
                    Eliminar bloque
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <label className="pbc-pybot-card__label pbc-pybot-card__label--dot" htmlFor={titleId}>
        Título
      </label>
      {editable ? (
        <input
          id={titleId}
          className="pbc-pybot-card__input"
          value={block.props.title}
          onChange={(event) => updateProp(editor, block, "title", event.target.value)}
          placeholder="Ejercicio 1: Calles y avenidas"
          aria-label="Título del ejercicio"
        />
      ) : (
        <p className="pbc-pybot-card__static">{block.props.title || "Ejercicio"}</p>
      )}

      <div className="pbc-pybot-card__grid">
        <div className="pbc-pybot-card__col">
          <label className="pbc-pybot-card__label" htmlFor={instructionsId}>
            Instrucciones
          </label>
          {editable ? (
            <textarea
              id={instructionsId}
              className="pbc-pybot-card__textarea"
              value={block.props.instructions}
              onChange={(event) => updateProp(editor, block, "instructions", event.target.value)}
              placeholder="Creá tres variables…"
              rows={6}
              aria-label="Instrucciones del ejercicio"
            />
          ) : (
            <p className="pbc-pybot-card__static pbc-pybot-card__static--pre">
              {block.props.instructions || "Sin instrucciones todavía."}
            </p>
          )}
        </div>

        <div className="pbc-pybot-card__col">
          <label className="pbc-pybot-card__label" htmlFor={codeId}>
            Código inicial
          </label>
          {editable ? (
            <textarea
              id={codeId}
              className="pbc-pybot-card__textarea pbc-pybot-card__textarea--code"
              value={block.props.starterCode}
              onChange={(event) => updateProp(editor, block, "starterCode", event.target.value)}
              placeholder={"print()"}
              rows={6}
              spellCheck={false}
              aria-label="Código inicial del ejercicio"
            />
          ) : block.props.starterCode ? (
            <pre className="pbc-pybot-card__code">{block.props.starterCode}</pre>
          ) : (
            <p className="pbc-pybot-card__static pbc-pybot-card__static--muted">Sin código inicial.</p>
          )}
        </div>
      </div>
    </div>
  );
}
