import { t } from "../../i18n.js";
import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";

/**
 * Adaptive Monaco height (px). Explicit height wins; default is content-driven.
 * Default bounds: min <=120px, max <=320px (1–3 lines ≈ 88–120px).
 */
export function resolveSubmissionCodeHeight(code, explicitHeight) {
  if (explicitHeight != null && explicitHeight !== "") {
    const n = Number(explicitHeight);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const text = code == null ? "" : String(code);
  const lineCount = text.length === 0 ? 1 : text.split("\n").length;
  const MIN = 88; // <=120px floor band for short code
  const MAX = 320; // <=320px ceiling; taller code scrolls internally
  // 1→88, 2→104, 3→120; grows by content then clamps (internal scroll at MAX).
  const computed = 72 + lineCount * 16;
  return Math.min(MAX, Math.max(MIN, computed));
}

function readUiTheme() {
  try {
    const stored = localStorage.getItem("pybot_theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    const dash = document.querySelector(".pbc-dashboard[data-pbc-theme]");
    const dashTheme = dash?.getAttribute("data-pbc-theme");
    if (dashTheme === "light" || dashTheme === "dark") return dashTheme;
    const htmlTheme =
      document.documentElement.getAttribute("data-theme") ||
      document.documentElement.getAttribute("data-pbc-theme");
    if (htmlTheme === "light" || htmlTheme === "dark") return htmlTheme;
  }
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

/**
 * Visor read-only del código de una entrega (Monaco).
 * No abre el IDE; muestra exactamente el string recibido.
 */
export default function SubmissionCodeViewer({
  code,
  height,
  language = "python",
  ariaLabel = t("pcDeliveredCode"),
}) {
  const [theme, setTheme] = useState(() => readUiTheme());

  useEffect(() => {
    const sync = () => setTheme(readUiTheme());
    sync();
    window.addEventListener("storage", sync);
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-pbc-theme"],
    });
    const dash = document.querySelector(".pbc-dashboard");
    if (dash) {
      obs.observe(dash, {
        attributes: true,
        attributeFilter: ["data-pbc-theme"],
      });
    }
    return () => {
      window.removeEventListener("storage", sync);
      obs.disconnect();
    };
  }, []);

  const value = code && String(code).length > 0 ? String(code) : t("pcEmptyCode");
  const monacoTheme = theme === "dark" ? "vs-dark" : "light";
  const resolvedHeight = resolveSubmissionCodeHeight(code, height);

  return (
    <div
      className="pbc-submission-code-viewer"
      role="region"
      aria-label={ariaLabel}
      style={{
        marginTop: "0.5rem",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid var(--pbc-border, rgba(127,127,127,0.35))",
        minHeight: resolvedHeight,
      }}
    >
      <Editor
        height={resolvedHeight}
        language={language}
        theme={monacoTheme}
        value={value}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          wordWrap: "on",
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
          lineNumbers: "on",
          renderLineHighlight: "none",
          padding: { top: 8, bottom: 8 },
          tabSize: 4,
          automaticLayout: true,
          contextmenu: false,
          folding: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
      />
    </div>
  );
}
