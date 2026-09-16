import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";

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
  height = 280,
  language = "python",
  ariaLabel = "Código entregado",
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

  const value = code && String(code).length > 0 ? String(code) : "# (vacío)";
  const monacoTheme = theme === "dark" ? "vs-dark" : "light";

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
        minHeight: height,
      }}
    >
      <Editor
        height={height}
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
