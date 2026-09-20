import { t } from "../../../i18n.js";
const VARIANT_CLASS = {
  blue: "pbc-badge--blue",
  teal: "pbc-badge--teal",
  purple: "pbc-badge--purple",
  gold: "pbc-badge--gold",
};

export default function RoleBadges({ badges = [] }) {
  if (!badges.length) {
    return <p className="pbc-account-card__email">{t("pcNoCoursesRole")}</p>;
  }

  return (
    <div className="pbc-role-badges" aria-label={t("pcRolesDetected")}>
      {badges.map((b) => (
        <span key={b.id} className={`pbc-badge ${VARIANT_CLASS[b.variant] || "pbc-badge--blue"}`}>
          {b.label}
        </span>
      ))}
    </div>
  );
}
