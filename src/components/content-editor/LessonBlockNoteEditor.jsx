import { filterSuggestionItems } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../styles/lesson-blocknote.css";
import { saveLessonDocument } from "../../platform/contentApi.js";
import { isSafeLessonLink, resolveContentMediaUrl, uploadContentMedia } from "./contentMedia.js";
import LessonInsertToolbar from "./LessonInsertToolbar.jsx";
import { buildLessonPreviewDocument } from "./normalizeReadOnlyFencedCode.js";
import { getPybotSlashMenuItems, pybotContentSchema, pybotDictionary } from "./pybotContentSchema.jsx";

const AUTOSAVE_MS = 1000;

function snapshotDocument(editor) {
  return JSON.stringify(editor.document);
}

/** Read-only BlockNote surface for Preview; mounts only while preview is on. */
function LessonPreviewDocument({ docKey, renderContent }) {
  const editor = useCreateBlockNote(
    {
      schema: pybotContentSchema,
      initialContent: renderContent?.length ? renderContent : undefined,
      dictionary: pybotDictionary,
      trailingBlock: false,
      animations: false,
      links: {
        isValidLink: isSafeLessonLink,
      },
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
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const setStatus = useCallback(
    (next) => {
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  // Edit mode always seeds from the persisted document (never a preview transform).
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

  // Preview render doc: normalize fences for display only (editable doc untouched).
  const previewRenderDocument = useMemo(() => {
    if (!preview) return null;
    return buildLessonPreviewDocument(editor.document);
  }, [preview, editor]);

  const persistNow = useCallback(async () => {
    // Always persist the editable editor document (never the preview render tree).
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
    if (previewRef.current) return;
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
      {preview && previewRenderDocument ? (
        <LessonPreviewDocument
          docKey={`${lessonId}-preview`}
          renderContent={previewRenderDocument}
        />
      ) : (
        <div className="pbc-lesson-doc">
          <BlockNoteView
            editor={editor}
            theme="light"
            editable={true}
            slashMenu={false}
            emojiPicker={false}
            comments={false}
            formattingToolbar={true}
            sideMenu={true}
            filePanel={true}
            tableHandles={true}
            linkToolbar={true}
            onChange={handleChange}
            className="pbc-bn"
          >
            <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
          </BlockNoteView>
        </div>
      )}
    </div>
  );
});

export default LessonBlockNoteEditor;
