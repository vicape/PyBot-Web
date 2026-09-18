/**
 * Regression tests for IDE-01 / IDE-02 document integrity.
 *
 * Proves that loading a new document invalidates stale representation state,
 * and that Run / Save / Submit consumers resolve the same snapshot source.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PYBLOCK_WORKSPACE_STORAGE_KEY,
  buildDocumentReplacePatch,
  createProgramSnapshot,
  getCurrentProgramSnapshot,
  nextDocumentIdentity,
  resolveActivePythonSource,
  snapshotsMatchRevision,
} from "../src/documentSnapshot.js";

const ideSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/PyBotIDE.jsx"),
  "utf8",
);

const converters = {
  pythonToPseudocode: (src) => `#pseudo\n${src}`,
  pythonToAst: (src) => ({ kind: "ast", src }),
  astToBlockly: (ast) => ({ blocks: true, src: ast.src }),
  convertPseudoToPython: (pseudo) =>
    String(pseudo || "").replace(/^#pseudo\n/, ""),
  convertFlowToPython: (ast) => (ast && ast.src != null ? String(ast.src) : ""),
};

test("resolveActivePythonSource: python mode uses canonical code", () => {
  assert.equal(
    resolveActivePythonSource({
      editorMode: "python",
      code: "print(1)",
      pyblockCode: "print(99)",
      pseudoCode: "print(88)",
      flowAst: { src: "print(77)" },
    }),
    "print(1)",
  );
});

test("resolveActivePythonSource: alternate modes prefer the visible representation", () => {
  assert.equal(
    resolveActivePythonSource({
      editorMode: "pyblock",
      code: "print(1)",
      pyblockCode: "print('blocks')",
      convertPseudoToPython: converters.convertPseudoToPython,
      convertFlowToPython: converters.convertFlowToPython,
    }),
    "print('blocks')",
  );
  assert.equal(
    resolveActivePythonSource({
      editorMode: "pseudo",
      code: "print(1)",
      pseudoCode: "#pseudo\nprint('pseudo')",
      convertPseudoToPython: converters.convertPseudoToPython,
      convertFlowToPython: converters.convertFlowToPython,
    }),
    "print('pseudo')",
  );
  assert.equal(
    resolveActivePythonSource({
      editorMode: "flow",
      code: "print(1)",
      flowAst: { src: "print('flow')" },
      convertPseudoToPython: converters.convertPseudoToPython,
      convertFlowToPython: converters.convertFlowToPython,
    }),
    "print('flow')",
  );
});

test("IDE-01: buildDocumentReplacePatch invalidates stale representation state", () => {
  const programA = "print('A')";
  const programB = "print('B')";

  const whilePseudo = buildDocumentReplacePatch(programB, "pseudo", converters);
  assert.equal(whilePseudo.code, programB);
  assert.equal(whilePseudo.pseudoCode, `#pseudo\n${programB}`);
  assert.equal(whilePseudo.flowAst, null);
  assert.equal(whilePseudo.pyblockCode, "");
  assert.equal(whilePseudo.pyblockIncoming, null);
  assert.deepEqual(whilePseudo.viewEdited, {
    pseudo: false,
    flow: false,
    pyblock: false,
  });
  assert.equal(whilePseudo.clearPyblockWorkspaceStorage, true);
  // Old program A must not remain as the active pseudo content.
  assert.equal(whilePseudo.pseudoCode.includes(programA), false);

  const whileBlocks = buildDocumentReplacePatch(programB, "pyblock", converters);
  assert.equal(whileBlocks.pyblockCode, programB);
  assert.deepEqual(whileBlocks.pyblockIncoming, { blocks: true, src: programB });
  assert.equal(whileBlocks.pseudoCode, `#pseudo\n${programB}`);

  const whileFlow = buildDocumentReplacePatch(programB, "flow", converters);
  assert.deepEqual(whileFlow.flowAst, { kind: "ast", src: programB });
});

test("IDE-01: opening a new document bumps identity so old views cannot share revision", () => {
  const a = nextDocumentIdentity({ revision: 0, documentId: 0 });
  const b = nextDocumentIdentity(a);
  assert.equal(a.documentId, 1);
  assert.equal(b.documentId, 2);
  assert.notEqual(a.documentId, b.documentId);
  assert.notEqual(a.revision, b.revision);
});

test("IDE-02: Run and Save resolve the same current document snapshot", () => {
  const state = {
    editorMode: "pseudo",
    code: "print('stale-python')",
    pseudoCode: "#pseudo\nprint('visible')",
    pyblockCode: "",
    flowAst: null,
    filename: "tarea.py",
    revision: 4,
    documentId: 2,
    convertPseudoToPython: converters.convertPseudoToPython,
    convertFlowToPython: converters.convertFlowToPython,
  };

  const forRun = getCurrentProgramSnapshot(state);
  const forSave = getCurrentProgramSnapshot(state);

  assert.equal(forRun.source, "print('visible')");
  assert.equal(forSave.source, forRun.source);
  assert.equal(forSave.documentId, forRun.documentId);
  assert.equal(forSave.revision, forRun.revision);
  assert.ok(snapshotsMatchRevision(forRun, forSave));
  // Stale canonical Python must not win while Pseudo is visible.
  assert.notEqual(forRun.source, state.code);
});

test("IDE-02: Save and Submit resolve the same current document snapshot", () => {
  const state = {
    editorMode: "pyblock",
    code: "print('old')",
    pyblockCode: "print('edited-blocks')",
    pseudoCode: "",
    flowAst: null,
    filename: "programa.py",
    revision: 7,
    documentId: 3,
    convertPseudoToPython: converters.convertPseudoToPython,
    convertFlowToPython: converters.convertFlowToPython,
  };

  const saveSnap = getCurrentProgramSnapshot(state);
  const submitSnap = getCurrentProgramSnapshot(state);
  assert.equal(saveSnap.source, "print('edited-blocks')");
  assert.equal(submitSnap.source, saveSnap.source);
  assert.equal(submitSnap.revision, saveSnap.revision);
});

test("IDE-01: switching representations after replace cannot resurrect previous document", () => {
  const first = buildDocumentReplacePatch("print('A')", "python", converters);
  const second = buildDocumentReplacePatch("print('B')", "python", converters);

  // After replace, pseudo is derived from B even if we were not viewing it.
  assert.match(second.pseudoCode, /print\('B'\)/);
  assert.doesNotMatch(second.pseudoCode, /print\('A'\)/);
  // Flow/blocks stay cleared until derived from the new canonical source.
  assert.equal(second.flowAst, null);
  assert.equal(second.pyblockIncoming, null);
  assert.notEqual(first.pseudoCode, second.pseudoCode);
});

test("async persistence must use a captured snapshot source, not a later state", async () => {
  const live = {
    editorMode: "python",
    code: "print('v1')",
    filename: "programa.py",
    revision: 1,
    documentId: 1,
  };
  const captured = getCurrentProgramSnapshot(live);

  // Simulate the user editing after the async operation started.
  live.code = "print('v2-stale-if-reread')";

  const persisted = await Promise.resolve(captured.source);
  assert.equal(persisted, "print('v1')");
  assert.notEqual(persisted, live.code);
});

test("createProgramSnapshot freezes the payload for the duration of an operation", () => {
  const snap = createProgramSnapshot({
    source: "print(1)",
    filename: "a.py",
    representation: "python",
    revision: 1,
    documentId: 1,
  });
  assert.ok(Object.isFrozen(snap));
  assert.throws(() => {
    snap.source = "mutated";
  });
  assert.equal(snap.source, "print(1)");
});

test("PYBLOCK_WORKSPACE_STORAGE_KEY is stable for defensive localStorage clears", () => {
  assert.equal(PYBLOCK_WORKSPACE_STORAGE_KEY, "pybot_pyblock_workspace");
});

test("PyBotIDE wires Run/Save/Submit/autosave through captureProgramSnapshot", () => {
  assert.match(ideSrc, /from "\.\/documentSnapshot\.js"/);
  assert.match(ideSrc, /const snapshot = captureProgramSnapshot\(\)/);
  assert.match(ideSrc, /replaceLogicalDocument/);

  const runStart = ideSrc.indexOf("const onRun = useCallback");
  assert.ok(runStart >= 0);
  const runBody = ideSrc.slice(runStart, runStart + 900);
  assert.match(runBody, /captureProgramSnapshot/);
  assert.match(runBody, /snapshot\.source/);

  const saveStart = ideSrc.indexOf("const onSaveLocal = useCallback");
  assert.ok(saveStart >= 0);
  const saveBody = ideSrc.slice(saveStart, saveStart + 900);
  assert.match(saveBody, /captureProgramSnapshot/);
  assert.match(saveBody, /snapshot\.source/);
  assert.doesNotMatch(saveBody, /writable\.write\(code\)/);

  const submitStart = ideSrc.indexOf("const onSubmitActivity = useCallback");
  assert.ok(submitStart >= 0);
  const submitBody = ideSrc.slice(submitStart, submitStart + 700);
  assert.match(submitBody, /captureProgramSnapshot/);
  assert.match(submitBody, /submitActivity\(activityId, snapshot\.source\)/);

  assert.match(ideSrc, /saveActivityProgress\(activityId, sessionUser\.id, source\)/);
});

test("PyBotIDE loadExample and open-file replace the logical document", () => {
  const loadStart = ideSrc.indexOf("const loadExample = useCallback");
  assert.ok(loadStart >= 0);
  const loadBody = ideSrc.slice(loadStart, loadStart + 400);
  assert.match(loadBody, /replaceLogicalDocument\(ex\.code\)/);
  assert.doesNotMatch(loadBody, /setCode\(ex\.code\)/);

  const openStart = ideSrc.indexOf("const onFileSelected = useCallback");
  assert.ok(openStart >= 0);
  const openBody = ideSrc.slice(openStart, openStart + 500);
  assert.match(openBody, /replaceLogicalDocument\(/);
  assert.doesNotMatch(openBody, /setCode\(String\(text/);
});

test("PyBlockEditor remounts on documentId so Blocks cannot keep a stale workspace", () => {
  assert.match(ideSrc, /key=\{`pyblock-doc-\$\{documentId\}`\}/);
  assert.match(ideSrc, /localStorage\.removeItem\(PYBLOCK_WORKSPACE_STORAGE_KEY\)/);
});
