function updateProp(editor, block, key, value) {
  if (!editor.isEditable) return;
  editor.updateBlock(block, { props: { [key]: value } });
}

export default function PybotExerciseBlock({ block, editor }) {
  const editable = editor.isEditable;
  const titleId = `${block.id}-exercise-title`;
  const instructionsId = `${block.id}-exercise-instructions`;
  const codeId = `${block.id}-exercise-code`;

  return (
    <div className="pbc-pybot-card pbc-pybot-card--exercise" contentEditable={false}>
      <div className="pbc-pybot-card__top">
        <span className="pbc-pybot-card__badge">Ejercicio</span>
        <span className="pbc-pybot-card__hint">Actividad de programación</span>
      </div>

      <label className="pbc-pybot-card__label" htmlFor={titleId}>
        Título
      </label>
      {editable ? (
        <input
          id={titleId}
          className="pbc-pybot-card__input"
          value={block.props.title}
          onChange={(event) => updateProp(editor, block, "title", event.target.value)}
          placeholder="Practicá con variables"
          aria-label="Título del ejercicio"
        />
      ) : (
        <p className="pbc-pybot-card__static">{block.props.title || "Ejercicio"}</p>
      )}

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
          rows={3}
          aria-label="Instrucciones del ejercicio"
        />
      ) : (
        <p className="pbc-pybot-card__static pbc-pybot-card__static--pre">
          {block.props.instructions || "Sin instrucciones todavía."}
        </p>
      )}

      <label className="pbc-pybot-card__label" htmlFor={codeId}>
        Código inicial
      </label>
      {editable ? (
        <textarea
          id={codeId}
          className="pbc-pybot-card__textarea pbc-pybot-card__textarea--code"
          value={block.props.starterCode}
          onChange={(event) => updateProp(editor, block, "starterCode", event.target.value)}
          placeholder="edad ="
          rows={4}
          spellCheck={false}
          aria-label="Código inicial del ejercicio"
        />
      ) : block.props.starterCode ? (
        <pre className="pbc-pybot-card__code">{block.props.starterCode}</pre>
      ) : (
        <p className="pbc-pybot-card__static pbc-pybot-card__static--muted">Sin código inicial.</p>
      )}
    </div>
  );
}
