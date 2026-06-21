/**
 * PyBlock — Editor visual por bloques (MVP). Módulo NUEVO y AISLADO.
 *
 * - Inyecta un workspace de Blockly con la toolbox de PyBlock.
 * - Genera Python real de PyBot en cada cambio y lo informa via onGenerated.
 * - Persiste el workspace en localStorage (pybot_pyblock_workspace).
 * - Muestra el Python generado en modo solo-lectura y permite "Copiar a Python".
 *
 * Si algo falla, se intenta no romper: el modo Python sigue intacto porque este
 * componente solo se monta cuando el editor está en modo PyBlock.
 */

import { useEffect, useRef, useState } from "react";
import * as Blockly from "blockly";
import { PYBLOCK_TOOLBOX } from "./pyblockToolbox.js";
import { pyblockWorkspaceToPython } from "./pyblockGenerator.js";
import "./pyblockBlocks.js";
import "./pyblock.css";

const WORKSPACE_KEY = "pybot_pyblock_workspace";

export default function PyBlockEditor({ theme, onGenerated, onCopyToPython }) {
  const containerRef = useRef(null);
  const workspaceRef = useRef(null);
  const [python, setPython] = useState("");

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return undefined;

    let workspace;
    try {
      workspace = Blockly.inject(host, {
        toolbox: PYBLOCK_TOOLBOX,
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

    // Restaurar workspace guardado.
    try {
      const saved = localStorage.getItem(WORKSPACE_KEY);
      if (saved) {
        Blockly.serialization.workspaces.load(JSON.parse(saved), workspace);
      }
    } catch {
      /* workspace inválido: empezar vacío */
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

    regenerate();
    workspace.addChangeListener((event) => {
      if (event && event.isUiEvent) return;
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

  return (
    <div className="pyblock-root" data-theme={theme}>
      <div ref={containerRef} className="pyblock-canvas" />
      <div className="pyblock-preview">
        <div className="pyblock-preview__head">
          <span>Python generado</span>
          <button
            type="button"
            className="pyblock-copy"
            onClick={() => onCopyToPython?.(python)}
            disabled={!python.trim()}
          >
            Copiar a Python
          </button>
        </div>
        <pre className="pyblock-code">
          {python || "# Arrastrá bloques desde la izquierda para generar Python."}
        </pre>
      </div>
    </div>
  );
}
