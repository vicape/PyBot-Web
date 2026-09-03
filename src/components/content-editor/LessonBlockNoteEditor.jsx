import { filterSuggestionItems } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../styles/lesson-blocknote.css";
import { saveLessonDocument } from "../../platform/contentApi.js";
import { isSafeLessonLink, resolveContentMediaUrl, uploadContentMedia } from "./contentMedia.js";
import LessonInsertToolbar from "./LessonInsertToolbar.jsx";
import { getPybotSlashMenuItems, pybotContentSchema, pybotDictionary } from "./pybotContentSchema.jsx";

const AUTOSAVE_MS = 1000;

function snapshotDocument(editor) {
  return JSON.stringify(editor.document);
}

const LessonBlockNoteEditor = forwardRef(function LessonBlockNoteEditor(
  { lessonId, contentId, initialContent, documentVersion = 1, preview = false, onStatusChange },
  ref,
) {
  const idsRef = useRef({ contentId, lessonId });
  idsRef.current = { contentId, lessonId };

  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef(null);
  const versionRef = useRef(documentVersion ?? 1);
  const lastSavedRef = useRef(JSON.stringify(initialContent));
  const editorRef = useRef(null);

  const setStatus = useCallback(
    (next) => {
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  const editor = useCreateBlockNote(
    {
      schema: pybotContentSchema,
      initialContent,
      dictionary: pybotDictionary,
      trailingBlock: true,
      animations: true,
      tables: {
        splitCells: true,
        headers: true,
      },
      links: {
        isValidLink: isSafeLessonLink,
      },
      uploadFile: async (file) => uploadContentMedia(file, idsRef.current),
      resolveFileUrl: resolveContentMediaUrl,
    },
    [lessonId],
  );

  editorRef.current = editor;

  const persistNow = useCallback(async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !hydratedRef.current) return false;
    if (savingRef.current) return false;

    const snapshot = snapshotDocument(currentEditor);
    if (snapshot === lastSavedRef.current) {
      dirtyRef.current = false;
      setStatus("saved");
      return true;
    }

    savingRef.current = true;
    setStatus("saving");
    const { lesson, error } = await saveLessonDocument(
      idsRef.current.lessonId,
      JSON.parse(snapshot),
      versionRef.current,
    );
    savingRef.current = false;

    if (error || !lesson) {
      dirtyRef.current = true;
      setStatus("error");
      return false;
    }

    lastSavedRef.current = snapshot;
    versionRef.current = lesson.document_version ?? versionRef.current;
    const latest = snapshotDocument(currentEditor);
    if (latest !== snapshot) {
      dirtyRef.current = true;
      setStatus("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void persistNow();
      }, AUTOSAVE_MS);
      return true;
    }

    dirtyRef.current = false;
    setStatus("saved");
    return true;
  }, [setStatus]);

  const persistNowRef = useRef(persistNow);
  persistNowRef.current = persistNow;

  useImperativeHandle(ref, () => ({
    flush: () => persistNowRef.current(),
  }));

  const scheduleSave = useCallback(() => {
    if (!hydratedRef.current) return;
    dirtyRef.current = true;
    setStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void persistNowRef.current();
    }, AUTOSAVE_MS);
  }, [setStatus]);

  useEffect(() => {
    hydratedRef.current = false;
    const ready = window.setTimeout(() => {
      hydratedRef.current = true;
    }, 80);
    return () => window.clearTimeout(ready);
  }, [lessonId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current && hydratedRef.current) {
        void persistNowRef.current();
      }
    };
  }, [lessonId]);

  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && hydratedRef.current) {
        void persistNowRef.current();
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const handleChange = useCallback(() => {
    if (!hydratedRef.current) return;
    if (snapshotDocument(editor) === lastSavedRef.current) return;
    scheduleSave();
  }, [editor, scheduleSave]);

  const getSlashItems = useCallback(
    async (query) => filterSuggestionItems(getPybotSlashMenuItems(editor), query),
    [editor],
  );

  return (
    <div className={`pbc-lesson-workspace${preview ? " pbc-lesson-workspace--preview" : ""}`}>
      {preview ? null : <LessonInsertToolbar editor={editor} disabled={!editor.isEditable} />}
      <div className={`pbc-lesson-doc${preview ? " pbc-lesson-doc--preview" : ""}`}>
        <BlockNoteView
          editor={editor}
          theme="light"
          editable={!preview}
          slashMenu={false}
          emojiPicker={false}
          comments={false}
          formattingToolbar={!preview}
          sideMenu={!preview}
          filePanel={!preview}
          tableHandles={!preview}
          linkToolbar={!preview}
          onChange={handleChange}
          className="pbc-bn"
        >
          {preview ? null : (
            <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
          )}
        </BlockNoteView>
      </div>
    </div>
  );
});

export default LessonBlockNoteEditor;
