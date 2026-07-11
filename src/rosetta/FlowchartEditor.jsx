/**
 * Rosetta — Editor de diagrama de flujo ESTRUCTURADO.
 *
 * Se arma con figuras (proceso, entrada, salida, decision, bucles, funcion) que
 * se insertan en la estructura. Cada figura es un nodo del AST, por lo que la
 * conversion a Python / pseudocodigo / bloques siempre queda limpia.
 *
 * A la izquierda se construye; a la derecha se ve el diagrama real en vivo.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { t } from "../i18n.js";
import { astToFlowchart } from "./flowchart.js";
import {
  SHAPE_KINDS,
  SHAPE_META,
  makeNode,
  nodeKind,
  editableText,
  applyText,
  childLists,
} from "./astEdit.js";

// Propiedades SVG que necesitamos inlinear para que el canvas las vea.
const SVG_PROPS = [
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap",
  "stroke-linejoin", "opacity", "font-size", "font-family", "font-weight",
  "text-anchor", "dominant-baseline",
];

/**
 * Clona el SVG e inlinea los estilos computados en cada elemento para que
 * Canvas los pueda renderizar sin depender de las hojas de estilo del documento.
 */
function cloneWithInlineStyles(svgEl) {
  const clone = svgEl.cloneNode(true);
  const origEls = Array.from(svgEl.querySelectorAll("*"));
  const cloneEls = Array.from(clone.querySelectorAll("*"));
  origEls.forEach((orig, i) => {
    const cl = cloneEls[i];
    if (!cl || cl.nodeType !== 1) return;
    const cs = getComputedStyle(orig);
    cl.removeAttribute("class");
    for (const prop of SVG_PROPS) {
      const val = cs.getPropertyValue(prop);
      if (val) cl.setAttribute(prop, val);
    }
  });
  // Fondo del SVG raiz: usamos el color de fondo del tema.
  clone.style.background = "transparent";
  return clone;
}

/**
 * Exporta el SVG como PNG y lo copia al portapapeles.
 * Si el API del portapapeles no está disponible, descarga el archivo.
 */
async function copySvgAsPng(svgEl, scale = 2) {
  const w = parseFloat(svgEl.getAttribute("width")) || svgEl.viewBox.baseVal.width;
  const h = parseFloat(svgEl.getAttribute("height")) || svgEl.viewBox.baseVal.height;
  const styledClone = cloneWithInlineStyles(svgEl);
  const svgStr = new XMLSerializer().serializeToString(styledClone);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * scale);
      canvas.height = Math.ceil(h * scale);
      const ctx = canvas.getContext("2d");
      // Fondo del color del tema actual.
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()
        || "#0d1117";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(async (pngBlob) => {
        if (!pngBlob) { reject(new Error("no blob")); return; }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": pngBlob }),
          ]);
          resolve("copied");
        } catch {
          // Fallback: descarga directa si el navegador bloquea el portapapeles.
          const a = document.createElement("a");
          a.href = URL.createObjectURL(pngBlob);
          a.download = "flowchart.png";
          a.click();
          resolve("downloaded");
        }
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img load failed")); };
    img.src = url;
  });
}

let _uid = 1;
function ensureId(stmt) {
  if (stmt && !stmt._id) stmt._id = "s" + _uid++;
  return stmt;
}

function ShapeChip({ kind }) {
  const shape = SHAPE_META[kind]?.shape ?? "rect";
  return <span className={`flow-chip flow-chip--${shape}`} aria-hidden />;
}

function InsertMenu({ onInsert }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flow-insert">
      <button
        type="button"
        className="flow-insert__btn"
        title={t("flowInsert")}
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>
      {open ? (
        <div className="flow-insert__menu">
          {SHAPE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className="flow-insert__item"
              onClick={() => {
                onInsert(k);
                setOpen(false);
              }}
            >
              <ShapeChip kind={k} />
              {t(SHAPE_META[k].key)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatementCard({ stmt, onReplace, onDelete, bump, labels }) {
  const kind = nodeKind(stmt);
  const lists = childLists(stmt, labels);
  return (
    <div className={`flow-card flow-card--${SHAPE_META[kind]?.shape ?? "rect"}`}>
      <div className="flow-card__row">
        <ShapeChip kind={kind} />
        <input
          key={stmt._id}
          className="flow-card__text"
          defaultValue={editableText(stmt)}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const next = applyText(stmt, e.target.value);
            if (next !== stmt) onReplace(next);
          }}
        />
        <button
          type="button"
          className="flow-card__del"
          title={t("flowDelete")}
          onClick={onDelete}
        >
          ×
        </button>
      </div>
      {lists.length > 0 ? (
        <div className="flow-card__children">
          {lists.map((cl) => (
            <div key={cl.kind} className="flow-branch">
              <span className="flow-branch__label">{cl.label}</span>
              <StatementList list={cl.list} bump={bump} labels={labels} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatementList({ list, bump, labels }) {
  list.forEach(ensureId);
  return (
    <div className="flow-list">
      {list.map((stmt, i) => (
        <div key={stmt._id}>
          <InsertMenu
            onInsert={(k) => {
              list.splice(i, 0, ensureId(makeNode(k)));
              bump();
            }}
          />
          <StatementCard
            stmt={stmt}
            bump={bump}
            labels={labels}
            onReplace={(n) => {
              list[i] = ensureId(n);
              bump();
            }}
            onDelete={() => {
              list.splice(i, 1);
              bump();
            }}
          />
        </div>
      ))}
      <InsertMenu
        onInsert={(k) => {
          list.push(ensureId(makeNode(k)));
          bump();
        }}
      />
    </div>
  );
}

export default function FlowchartEditor({ ast, onAstChange, lang }) {
  const labels = useMemo(
    () => ({
      then: t("flowBranchThen"),
      else: t("flowBranchElse"),
      body: t("flowBranchBody"),
    }),
    [lang],
  );

  const svg = useMemo(() => {
    try {
      return astToFlowchart(ast, { lang });
    } catch {
      return "";
    }
  }, [ast, lang]);

  const [copyState, setCopyState] = useState("idle"); // "idle" | "ok" | "dl"
  const handleCopy = useCallback(async () => {
    const svgEl = previewRef.current?.querySelector("svg");
    if (!svgEl) return;
    setCopyState("idle");
    try {
      const result = await copySvgAsPng(svgEl, 2);
      setCopyState(result === "downloaded" ? "dl" : "ok");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("idle");
    }
  }, []);

  const [zoom, setZoom] = useState(1);
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 2.5;
  const ZOOM_STEP = 1.2;
  const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const zoomIn = () => setZoom((z) => clampZoom(z * ZOOM_STEP));
  const zoomOut = () => setZoom((z) => clampZoom(z / ZOOM_STEP));
  const zoomReset = () => setZoom(1);
  const previewRef = useRef(null);

  const bump = () => onAstChange({ ...ast, body: ast.body });

  if (!ast || !Array.isArray(ast.body)) return null;

  return (
    <div className="flow-editor">
      <div className="flow-editor__build">
        <div className="flow-editor__hint">{t("flowEditorHint")}</div>
        <StatementList list={ast.body} bump={bump} labels={labels} />
      </div>
      <div className="flow-editor__preview">
        <div className="flow-zoom" role="group" aria-label={t("flowZoomLabel")}>
          <button type="button" className="flow-zoom__btn" onClick={zoomOut} title={t("flowZoomOut")}>
            −
          </button>
          <button
            type="button"
            className="flow-zoom__btn flow-zoom__btn--reset"
            onClick={zoomReset}
            title={t("flowZoomReset")}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="flow-zoom__btn" onClick={zoomIn} title={t("flowZoomIn")}>
            +
          </button>
          <div className="flow-zoom__sep" />
          <button
            type="button"
            className={`flow-zoom__btn flow-zoom__btn--copy ${copyState !== "idle" ? "flow-zoom__btn--ok" : ""}`}
            onClick={handleCopy}
            title={t("flowCopyBtn")}
          >
            {copyState === "ok" ? "✓" : copyState === "dl" ? "↓" : "⎘"}
          </button>
        </div>
        <div
          className="flow-editor__scroll"
          ref={previewRef}
          onWheel={(e) => {
            // Zoom con Ctrl/⌘ + rueda (como muchos editores).
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            setZoom((z) => clampZoom(z * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
          }}
        >
          <div
            className="flow-view__inner"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  );
}
