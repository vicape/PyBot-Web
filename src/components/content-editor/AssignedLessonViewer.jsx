import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../styles/lesson-blocknote.css";
import { isSafeLessonLink, resolveContentMediaUrl } from "./contentMedia.js";
import { pybotContentSchema, pybotDictionary } from "./pybotContentSchema.jsx";

/**
 * Documento de lección en solo lectura (actividades asignadas).
 */
export default function AssignedLessonViewer({ lessonId, initialContent }) {
  const editor = useCreateBlockNote(
    {
      schema: pybotContentSchema,
      initialContent: initialContent?.length ? initialContent : undefined,
      dictionary: pybotDictionary,
      trailingBlock: false,
      animations: false,
      links: {
        isValidLink: isSafeLessonLink,
      },
      resolveFileUrl: resolveContentMediaUrl,
    },
    [lessonId],
  );

  return (
    <div className="pbc-lesson-workspace pbc-lesson-workspace--preview pbc-assigned-lesson">
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
    </div>
  );
}
