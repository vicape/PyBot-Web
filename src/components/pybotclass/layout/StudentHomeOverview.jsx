import { t } from "../../../i18n.js";
import { Link } from "react-router-dom";
import { CompactJoinIcon } from "../illustrations/ActionIcons.jsx";
import PbcIcon from "../PbcIcon.jsx";

function CompactCreateIcon() {
  return <PbcIcon name="create" size={18} />;
}

function CompactContentIcon() {
  return <PbcIcon name="content" size={20} />;
}

function CompactIdeIcon() {
  return <PbcIcon name="ide" size={18} />;
}

/**
 * Student-only Home overview: welcome, real continuation CTA, secondary actions.
 * Presentation only — no fetches; parent supplies already-loaded Home data.
 */
export default function StudentHomeOverview({
  firstName,
  studentCourseCount = 0,
  continueCourse = null,
  onCreateCourse,
  onJoinCourse,
}) {
  const hasContinue = Boolean(continueCourse?.course_id);
  const continueHref = hasContinue
    ? `/dashboard/classes/${continueCourse.course_id}`
    : "/dashboard/classes?view=courses";
  const continueTitle = hasContinue
    ? t("pcContinueLearning")
    : t("pcViewMyCourses");
  const continueDesc = hasContinue
    ? t("pcContinueLearningIn").replace("{course}", continueCourse.course_title || "")
    : t("pcStudentHomeEmptyHint");

  return (
    <section className="pbc-student-overview" aria-labelledby="student-home-heading">
      <header className="pbc-student-overview__welcome">
        <div className="pbc-student-overview__text">
          <h1 id="student-home-heading" className="pbc-hero-block__title">
            {t("pcHello")}, {firstName}
          </h1>
          <p className="pbc-hero-block__subtitle">{t("pcStudentHomeLead")}</p>
          {studentCourseCount > 0 ? (
            <p className="pbc-student-overview__summary">
              {t("pcStudentCourseCount").replace("{n}", String(studentCourseCount))}
            </p>
          ) : null}
        </div>
      </header>

      <div className="pbc-student-continue">
        <Link
          to={continueHref}
          className="pbc-student-continue__card"
          aria-label={
            hasContinue
              ? `${continueTitle}: ${continueCourse.course_title || ""}`
              : continueTitle
          }
        >
          <span className="pbc-student-continue__icon" aria-hidden>
            <PbcIcon name={hasContinue ? "course" : "courses"} size={22} />
          </span>
          <span className="pbc-student-continue__body">
            <span className="pbc-student-continue__title">{continueTitle}</span>
            <span className="pbc-student-continue__desc">{continueDesc}</span>
          </span>
          <span className="pbc-student-continue__chevron" aria-hidden>
            <PbcIcon name="next" size={16} />
          </span>
        </Link>
      </div>

      <div
        className="pbc-student-secondary pbc-action-grid"
        aria-label={t("pcStudentSecondaryActions")}
      >
        <button
          type="button"
          className="pbc-action-card pbc-action-card--join"
          onClick={onJoinCourse}
        >
          <span className="pbc-action-card__icon pbc-action-card__icon--violet" aria-hidden>
            <CompactJoinIcon />
          </span>
          <span className="pbc-action-card__body">
            <span className="pbc-action-card__title">{t("pcJoinCourse")}</span>
            <span className="pbc-action-card__desc">{t("pcActionJoinCourseHint")}</span>
          </span>
        </button>

        <button
          type="button"
          className="pbc-action-card pbc-action-card--create"
          onClick={onCreateCourse}
        >
          <span className="pbc-action-card__icon pbc-action-card__icon--blue" aria-hidden>
            <CompactCreateIcon />
          </span>
          <span className="pbc-action-card__body">
            <span className="pbc-action-card__title">{t("pcCreateCourse")}</span>
            <span className="pbc-action-card__desc">{t("pcActionCreateCourseHint")}</span>
          </span>
        </button>

        <Link to="/dashboard/content" className="pbc-action-card pbc-action-card--content">
          <span className="pbc-action-card__icon" aria-hidden>
            <CompactContentIcon />
          </span>
          <span className="pbc-action-card__body">
            <span className="pbc-action-card__title">{t("pcCreateContent")}</span>
            <span className="pbc-action-card__desc">{t("pcActionCreateContentHint")}</span>
          </span>
        </Link>

        <a href="/" className="pbc-action-card pbc-action-card--ide">
          <span className="pbc-action-card__icon pbc-action-card__icon--indigo" aria-hidden>
            <CompactIdeIcon />
          </span>
          <span className="pbc-action-card__body">
            <span className="pbc-action-card__title">{t("pcOpenIde")}</span>
            <span className="pbc-action-card__desc">{t("pcActionOpenIdeHint")}</span>
          </span>
        </a>
      </div>
    </section>
  );
}
