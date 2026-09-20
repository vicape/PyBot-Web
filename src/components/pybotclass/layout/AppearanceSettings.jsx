import { t } from "../../../i18n.js";
import { UI_BACKGROUNDS, UI_THEMES, isValidHexColor } from "../../../platform/appearanceApi.js";

const THEME_KEYS = { system: "pcThemeSystem", light: "pcThemeLight", dark: "pcThemeDark" };
const BG_KEYS = {
  default: "pcBackgroundDefault",
  clean: "pcBackgroundClean",
  "deep-blue": "pcBackgroundDeepBlue",
  indigo: "pcBackgroundIndigo",
  graphite: "pcBackgroundGraphite",
  custom: "pcBackgroundCustom",
};

export default function AppearanceSettings({ appearance, onChange, disabled = false }) {
  const set = (patch) => onChange?.({ ...appearance, ...patch });

  return (
    <section className="pbc-panel-card pbc-appearance-grid">
      <h3 className="pbc-panel-card__title">{t("pcAppearance")}</h3>

      <div>
        <span className="pbc-label">{t("pcTheme")}</span>
        <div className="pbc-appearance-options" role="group" aria-label={t("pcTheme")}>
          {UI_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`pbc-filter-tab${appearance.theme === t ? " pbc-filter-tab--active" : ""}`}
              onClick={() => set({ theme: t })}
              disabled={disabled}
            >
              {t(THEME_KEYS[t])}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="pbc-label">{t("pcBackground")}</span>
        <div className="pbc-appearance-options" role="group" aria-label={t("pcBackground")}>
          {UI_BACKGROUNDS.filter((b) => b !== "custom").map((b) => (
            <button
              key={b}
              type="button"
              className={`pbc-filter-tab${appearance.background === b ? " pbc-filter-tab--active" : ""}`}
              onClick={() => set({ background: b })}
              disabled={disabled}
            >
              {t(BG_KEYS[b])}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="pbc-label" htmlFor="pbc-custom-color">
          {t("pcCustomColor")}
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
