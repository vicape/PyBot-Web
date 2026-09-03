import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../styles/lesson-blocknote.css";
import { isSafeLessonLink, resolveContentMediaUrl } from "./contentMedia.js";
import { pybotContentSchema, pybotDictionary } from "./pybotContentSchema.jsx";

function ReadOnlyDoc({ docKey, initialContent }) {
  const editor = useCreateBlockNote(
    {
      schema: pybotContentSchema,
      initialContent: initialContent?.length ? initialContent : undefined,
      dictionary: pybotDictionary,
      trailingBlock: false,
      animations: false,
      links: { isValidLink: isSafeLessonLink },
      resolveFileUrl: resolveContentMediaUrl,
    },
    [docKey],
  );

  return (
    <div className="pbc-lesson-doc pbc-lesson-doc--preview">
      <BlockNoteView
        editor={editor}
        theme="light"
        editable={false}
        slashMenu={false}
        emojiPicker={false}
        comments={false}
        formattingToolbar={false}
        sideMenu={false}
        filePanel={false}
        tableHandles={false}
        linkToolbar={false}
        className="pbc-bn"
      />
    </div>
  );
}

function BlockCard({ kind, block }) {
  const title = block?.title || (kind === "exercise" ? "Ejercicio" : "Tarea");
  return (
    <div className={`pbc-pybot-card pbc-pybot-card--${kind === "exercise" ? "exercise" : "task"}`}>
      <div className="pbc-pybot-card__head">
        <strong>{title}</strong>
        <span className="pbc-pybot-card__kind">
          {kind === "exercise" ? "Actividad de programación" : "Tarea"}
        </span>
      </div>
      {block?.instructions ? (
        <div className="pbc-pybot-card__section">
          <div className="pbc-pybot-card__label">Instrucciones</div>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{block.instructions}</p>
        </div>
      ) : null}
      {block?.starterCode != null && String(block.starterCode).length > 0 ? (
        <div className="pbc-pybot-card__section">
          <div className="pbc-pybot-card__label">Código inicial</div>
          <pre className="pbc-pybot-card__code">{block.starterCode}</pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Viewer de snapshot inmutable para actividades.
 */
export default function AssignedContentSnapshotViewer({ snapshot }) {
  if (!snapshot) return null;

  const type = snapshot.sourceType;

  if (type === "exercise" || type === "task") {
    return (
      <div className="pbc-assigned-lesson">
        <BlockCard kind={type} block={snapshot.block || snapshot} />
      </div>
    );
  }

  if (type === "lesson") {
    return (
      <div className="pbc-lesson-workspace pbc-lesson-workspace--preview pbc-assigned-lesson">
        <ReadOnlyDoc docKey={snapshot.sourceId} initialContent={snapshot.document_json} />
      </div>
    );
  }

  if (type === "unit") {
    return (
      <div className="pbc-assigned-lesson">
        {(snapshot.lessons || []).map((lesson) => (
          <section key={lesson.id} className="pbc-activity-lesson" style={{ marginBottom: 24 }}>
            <h3 className="pbc-activity-lesson__title">{lesson.title}</h3>
            <div className="pbc-lesson-workspace pbc-lesson-workspace--preview">
              <ReadOnlyDoc docKey={lesson.id} initialContent={lesson.document_json} />
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (type === "content") {
    return (
      <div className="pbc-assigned-lesson">
        {(snapshot.units || []).map((unit) => (
          <section key={unit.id} style={{ marginBottom: 32 }}>
            <h2 className="pbc-activity-lesson__title">{unit.title}</h2>
            {(unit.lessons || []).map((lesson) => (
              <div key={lesson.id} className="pbc-activity-lesson" style={{ marginBottom: 20 }}>
                <h3 className="pbc-activity-lesson__title" style={{ fontSize: "1rem" }}>
                  {lesson.title}
                </h3>
                <div className="pbc-lesson-workspace pbc-lesson-workspace--preview">
                  <ReadOnlyDoc docKey={lesson.id} initialContent={lesson.document_json} />
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }

  return <p className="auth-card__muted">No hay contenido para mostrar.</p>;
}
