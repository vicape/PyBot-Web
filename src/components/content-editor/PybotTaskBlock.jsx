function updateProp(editor, block, key, value) {
  if (!editor.isEditable) return;
  editor.updateBlock(block, { props: { [key]: value } });
}

export default function PybotTaskBlock({ block, editor }) {
  const editable = editor.isEditable;
  const titleId = `${block.id}-task-title`;
  const instructionsId = `${block.id}-task-instructions`;
  const codeId = `${block.id}-task-code`;

  return (
    <div className="pbc-pybot-card pbc-pybot-card--task" contentEditable={false}>
      <div className="pbc-pybot-card__top">
        <span className="pbc-pybot-card__badge">Tarea</span>
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
          placeholder="Mini proyecto"
          aria-label="Título de la tarea"
        />
      ) : (
        <p className="pbc-pybot-card__static">{block.props.title || "Tarea"}</p>
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
          placeholder="Crear un programa…"
          rows={3}
          aria-label="Instrucciones de la tarea"
        />
      ) : (
        <p className="pbc-pybot-card__static pbc-pybot-card__static--pre">
          {block.props.instructions || "Sin instrucciones todavía."}
        </p>
      )}

      <label className="pbc-pybot-card__label" htmlFor={codeId}>
        Código inicial (opcional)
      </label>
      {editable ? (
        <textarea
          id={codeId}
          className="pbc-pybot-card__textarea pbc-pybot-card__textarea--code"
          value={block.props.starterCode}
          onChange={(event) => updateProp(editor, block, "starterCode", event.target.value)}
          placeholder="Podés dejar una pista de código"
          rows={3}
          spellCheck={false}
          aria-label="Código inicial de la tarea"
        />
      ) : block.props.starterCode ? (
        <pre className="pbc-pybot-card__code">{block.props.starterCode}</pre>
      ) : (
        <p className="pbc-pybot-card__static pbc-pybot-card__static--muted">Sin código inicial.</p>
      )}
    </div>
  );
}
