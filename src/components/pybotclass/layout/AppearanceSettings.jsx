import { UI_BACKGROUNDS, UI_THEMES, isValidHexColor } from "../../../platform/appearanceApi.js";

const THEME_LABELS = { system: "Sistema", light: "Claro", dark: "Oscuro" };
const BG_LABELS = {
  default: "Predeterminado",
  clean: "Limpio",
  "deep-blue": "Azul profundo",
  indigo: "Índigo",
  graphite: "Grafito",
  custom: "Color personalizado",
};

export default function AppearanceSettings({ appearance, onChange, disabled = false }) {
  const set = (patch) => onChange?.({ ...appearance, ...patch });

  return (
    <section className="pbc-panel-card pbc-appearance-grid">
      <h3 className="pbc-panel-card__title">Apariencia</h3>

      <div>
        <span className="pbc-label">Tema</span>
        <div className="pbc-appearance-options" role="group" aria-label="Tema">
          {UI_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`pbc-filter-tab${appearance.theme === t ? " pbc-filter-tab--active" : ""}`}
              onClick={() => set({ theme: t })}
              disabled={disabled}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="pbc-label">Fondo</span>
        <div className="pbc-appearance-options" role="group" aria-label="Fondo">
          {UI_BACKGROUNDS.filter((b) => b !== "custom").map((b) => (
            <button
              key={b}
              type="button"
              className={`pbc-filter-tab${appearance.background === b ? " pbc-filter-tab--active" : ""}`}
              onClick={() => set({ background: b })}
              disabled={disabled}
            >
              {BG_LABELS[b]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="pbc-label" htmlFor="pbc-custom-color">
          Color personalizado
        </label>
        <input
          id="pbc-custom-color"
          type="color"
          value={isValidHexColor(appearance.customColor) ? appearance.customColor : "#1e3a5f"}
          onChange={(e) => set({ background: "custom", customColor: e.target.value })}
          disabled={disabled}
        />
        <div
          className="pbc-appearance-preview"
          style={{
            background:
              appearance.background === "custom" && isValidHexColor(appearance.customColor)
                ? appearance.customColor
                : "var(--pbc-bg)",
          }}
          aria-hidden
        />
      </div>
    </section>
  );
}
