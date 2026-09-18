/**
 * Document integrity helpers for PyBot IDE (IDE-01 / IDE-02).
 *
 * Pure functions — no React, no I/O — so Run / Save / Submit / persistence
 * can share one immutable program snapshot without rewriting the IDE.
 *
 * Canonical model: Python source is the logical document. Alternate
 * representations (pseudo / flow / blocks) are views derived from it, except
 * when the user is actively editing that view (then the view is the source of
 * truth until flushed into a snapshot).
 */

export const PYBLOCK_WORKSPACE_STORAGE_KEY = "pybot_pyblock_workspace";

/**
 * Resolve the Python source that matches what the student currently sees.
 *
 * @param {{
 *   editorMode: string,
 *   code: string,
 *   pyblockCode: string,
 *   pseudoCode: string,
 *   flowAst: unknown,
 *   convertPseudoToPython?: (pseudo: string) => string,
 *   convertFlowToPython?: (ast: unknown) => string,
 * }} state
 * @returns {string}
 */
export function resolveActivePythonSource(state) {
  const {
    editorMode,
    code = "",
    pyblockCode = "",
    pseudoCode = "",
    flowAst = null,
    convertPseudoToPython,
    convertFlowToPython,
  } = state || {};

  if (editorMode === "pyblock") return String(pyblockCode ?? "");
  if (editorMode === "pseudo") {
    if (typeof convertPseudoToPython === "function") {
      return String(convertPseudoToPython(pseudoCode) ?? "");
    }
    return String(pseudoCode ?? "");
  }
  if (editorMode === "flow") {
    if (flowAst && typeof convertFlowToPython === "function") {
      return String(convertFlowToPython(flowAst) ?? "");
    }
    return String(code ?? "");
  }
  return String(code ?? "");
}

/**
 * Build an immutable snapshot consumed by Run / Save / Submit / persistence.
 *
 * @param {object} input
 * @returns {Readonly<{
 *   source: string,
 *   filename: string,
 *   representation: string,
 *   revision: number,
 *   documentId: number,
 * }>}
 */
export function createProgramSnapshot(input) {
  const {
    source = "",
    filename = "programa.py",
    representation = "python",
    revision = 0,
    documentId = 0,
  } = input || {};

  return Object.freeze({
    source: String(source ?? ""),
    filename: filename || "programa.py",
    representation: representation || "python",
    revision: Number(revision) || 0,
    documentId: Number(documentId) || 0,
  });
}

/**
 * Capture snapshot from live editor state (single entry point for consumers).
 */
export function getCurrentProgramSnapshot(state) {
  const source = resolveActivePythonSource(state);
  return createProgramSnapshot({
    source,
    filename: state?.filename,
    representation: state?.editorMode || "python",
    revision: state?.revision,
    documentId: state?.documentId,
  });
}

/**
 * Bump document identity when loading an example, opening a .py file, or
 * applying a new activity document.
 */
export function nextDocumentIdentity(prev) {
  const revision = (Number(prev?.revision) || 0) + 1;
  const documentId = (Number(prev?.documentId) || 0) + 1;
  return { revision, documentId };
}

/**
 * Pure patch describing how representation state must change when a new
 * logical document replaces the previous one. Applying this patch makes
 * alternate views derive from `pythonSource` and clears edit dirty-flags so
 * stale content cannot become active.
 *
 * @param {string} pythonSource
 * @param {string} editorMode
 * @param {{
 *   pythonToPseudocode: (src: string) => string,
 *   pythonToAst: (src: string) => unknown,
 *   astToBlockly: (ast: unknown) => unknown,
 * }} converters
 */
export function buildDocumentReplacePatch(pythonSource, editorMode, converters) {
  const source = String(pythonSource ?? "");
  const pythonToPseudocode = converters?.pythonToPseudocode || ((s) => s);
  const pythonToAst = converters?.pythonToAst || (() => null);
  const astToBlockly = converters?.astToBlockly || (() => null);

  let pseudoCode = "";
  try {
    pseudoCode = String(pythonToPseudocode(source) ?? "");
  } catch {
    pseudoCode = "";
  }

  let flowAst = null;
  if (editorMode === "flow") {
    try {
      flowAst = pythonToAst(source);
    } catch {
      flowAst = null;
    }
  }

  let pyblockIncoming = null;
  let pyblockCode = "";
  if (editorMode === "pyblock") {
    pyblockCode = source;
    try {
      pyblockIncoming = astToBlockly(pythonToAst(source));
    } catch {
      pyblockIncoming = null;
    }
  }

  return {
    code: source,
    pseudoCode,
    flowAst,
    pyblockCode,
    pyblockIncoming,
    viewEdited: { pseudo: false, flow: false, pyblock: false },
    clearPyblockWorkspaceStorage: true,
  };
}

/**
 * True when two snapshots refer to the same logical document revision.
 */
export function snapshotsMatchRevision(a, b) {
  if (!a || !b) return false;
  return a.documentId === b.documentId && a.revision === b.revision && a.source === b.source;
}
