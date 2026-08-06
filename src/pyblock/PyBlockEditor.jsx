/**
 * PyBlock — Editor visual por bloques (MVP). Módulo NUEVO y AISLADO.
 *
 * - Inyecta un workspace de Blockly con la toolbox de PyBlock.
 * - Genera Python real de PyBot en cada cambio y lo informa via onGenerated.
 * - Persiste el workspace en localStorage (pybot_pyblock_workspace).
 * - Muestra el Python generado en modo solo-lectura y permite "Copiar a Python".
 * - Sigue el idioma de la app (prop `lang`): categorías, bloques y textos del
 *   panel se re-traducen sin perder lo que el usuario armó.
 *
 * Si algo falla, se intenta no romper: el modo Python sigue intacto porque este
 * componente solo se monta cuando el editor está en modo PyBlock.
 */

import { useEffect, useRef, useState } from "react";
import * as Blockly from "blockly";
import { getPyblockToolbox } from "./pyblockToolbox.js";
import { pyblockWorkspaceToPython } from "./pyblockGenerator.js";
import { definePyblockBlocks } from "./pyblockBlocks.js";
import { t } from "../i18n.js";
import "./pyblock.css";

const WORKSPACE_KEY = "pybot_pyblock_workspace";

export default function PyBlockEditor({
  theme,
  lang,
  boardType,
  incoming,
  onGenerated,
  onEdited,
  onCopyToPython,
}) {
  const containerRef = useRef(null);
  const workspaceRef = useRef(null);
  const regenerateRef = useRef(() => {});
  const langRef = useRef(lang);
  const boardTypeRef = useRef(boardType);
  const incomingRef = useRef(incoming);
  const [python, setPython] = useState("");

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return undefined;

    definePyblockBlocks(langRef.current);

    let workspace;
    try {
      workspace = Blockly.inject(host, {
        toolbox: getPyblockToolbox(boardTypeRef.current),
        trashcan: true,
        scrollbars: true,
        move: { scrollbars: true, drag: true, wheel: true },
        zoom: { controls: true, wheel: true, startScale: 0.9 },
        grid: { spacing: 24, length: 3, colour: "#cccccc44", snap: true },
        renderer: "thrasos",
      });
    } catch {
      // No se pudo iniciar Blockly: no rompemos nada.
      return undefined;
    }
    workspaceRef.current = workspace;

    // Cargar el workspace: si llega un programa convertido desde otra
    // representacion (Python/pseudo/flowchart) lo priorizamos; si no, se
    // restaura lo que el alumno tenia guardado. Desactivamos los eventos
    // durante la carga para que no se dispare la generacion con bloques a
    // medio conectar (produciria codigo intermedio con sentencias sueltas).
    Blockly.Events.disable();
    try {
      if (incomingRef.current) {
        Blockly.serialization.workspaces.load(incomingRef.current, workspace);
      } else {
        const saved = localStorage.getItem(WORKSPACE_KEY);
        if (saved) {
          Blockly.serialization.workspaces.load(JSON.parse(saved), workspace);
        }
      }
    } catch {
      /* workspace inválido: empezar vacío */
    } finally {
      Blockly.Events.enable();
    }

    // Workspace vacío: insertar un bloque "Inicio" para guiar al alumno.
    try {
      if (workspace.getTopBlocks(false).length === 0) {
        Blockly.Events.disable();
        try {
          const start = workspace.newBlock("pyblock_start");
          start.initSvg();
          start.render();
          start.moveBy(40, 40);
        } finally {
          Blockly.Events.enable();
        }
      }
    } catch {
      /* si falla, el workspace simplemente queda vacío */
    }

    const regenerate = () => {
      try {
        const code = pyblockWorkspaceToPython(workspace);
        setPython(code);
        onGenerated?.(code);
        localStorage.setItem(
          WORKSPACE_KEY,
          JSON.stringify(Blockly.serialization.workspaces.save(workspace)),
        );
      } catch {
        /* ignorar errores de generación/guardado */
      }
    };
    regenerateRef.current = regenerate;

    regenerate();
    // La carga inicial se hizo con eventos desactivados, asi que cualquier
    // evento (no-UI) que llegue aca proviene de una edicion real del usuario.
    workspace.addChangeListener((event) => {
      if (event && event.isUiEvent) return;
      onEdited?.();
      regenerate();
    });

    // Ajuste de tamaño dentro del layout flexible.
    const resize = () => {
      try {
        Blockly.svgResize(workspace);
      } catch {
        /* ignore */
      }
    };
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(host);
    }
    window.addEventListener("resize", resize);
    const initialResize = setTimeout(resize, 60);

    return () => {
      clearTimeout(initialResize);
      window.removeEventListener("resize", resize);
      if (observer) observer.disconnect();
      try {
        workspace.dispose();
      } catch {
        /* ignore */
      }
      workspaceRef.current = null;
    };
    // Se monta una sola vez; el cambio de tema no re-tematiza en MVP.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambia el idioma de la app: re-traduce categorías y bloques,
  // conservando lo que el usuario ya armó (se recrea desde el estado guardado).
  useEffect(() => {
    if (langRef.current === lang) return;
    langRef.current = lang;
    const workspace = workspaceRef.current;
    if (!workspace) return;

    let saved = null;
    try {
      saved = Blockly.serialization.workspaces.save(workspace);
    } catch {
      /* si no se pudo guardar, seguimos igual */
    }

    definePyblockBlocks(lang);

    try {
      workspace.updateToolbox(getPyblockToolbox(boardTypeRef.current));
    } catch {
      /* si falla, la toolbox queda en el idioma anterior */
    }

    if (saved) {
      try {
        workspace.clear();
        Blockly.serialization.workspaces.load(saved, workspace);
      } catch {
        /* si falla la recarga, el workspace queda como estaba */
      }
    }
    regenerateRef.current?.();
  }, [lang]);

  // Cuando cambia la placa seleccionada: se reconstruye la categoría Hardware
  // de la toolbox para mostrar los bloques que corresponden (EDA6 vs genéricos).
  // Lo que el alumno ya armó en el workspace no se toca.
  useEffect(() => {
    if (boardTypeRef.current === boardType) return;
    boardTypeRef.current = boardType;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    try {
      workspace.updateToolbox(getPyblockToolbox(boardType));
    } catch {
      /* si falla, la toolbox queda con los bloques anteriores */
    }
  }, [boardType]);

  return (
    <div className="pyblock-root" data-theme={theme}>
      <div ref={containerRef} className="pyblock-canvas" />
      <div className="pyblock-preview">
        <div className="pyblock-preview__head">
          <span>{t("pyblockGeneratedLabel")}</span>
          <button
            type="button"
            className="pyblock-copy"
            onClick={() => onCopyToPython?.(python)}
            disabled={!python.trim()}
          >
            {t("pyblockCopyBtn")}
          </button>
        </div>
        <pre className="pyblock-code">{python || t("pyblockEmptyCode")}</pre>
      </div>
    </div>
  );
}
