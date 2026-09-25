import { t } from "../../i18n.js";
import { useEffect, useState } from "react";
import {
  fetchPybotclassCourseSummary,
  fetchPybotclassStudentSummary,
} from "../../platform/pybotClassApi.js";
import { COURSE_ACCESS_MODES } from "../../platform/courseRole.js";
import {
  resolveCourseNextStep,
  resolveCoursePrepGuide,
} from "../../platform/uxIaHelpers.js";
import {
  PbcAlert,
  PbcEmpty,
  PbcList,
  PbcListItem,
  PbcLoading,
  PbcSection,
  PbcStatGrid,
} from "./PyBotClassUi.jsx";

export default function CourseSummaryTab({
  courseId,
  mode,
  onGoSubmissions,
  onGoStudents,
  onGoCreateActivity,
  onGoAssignContent,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode === COURSE_ACCESS_MODES.NONE || !mode) {
        setSummary(null);
        setErr("");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr("");
      const fn =
        mode === COURSE_ACCESS_MODES.STUDYING
          ? fetchPybotclassStudentSummary
          : fetchPybotclassCourseSummary;
      const { summary: data, error } = await fn(courseId);
      if (cancelled) return;
      if (error) setErr(error);
      else setSummary(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, mode]);

  if (mode === COURSE_ACCESS_MODES.NONE || !mode) {
    return <PbcEmpty title={t("pcNoCourseAccess")} />;
  }

  if (loading) return <PbcLoading label={t("pcLoadingSummary")} />;
  if (err) return <PbcAlert variant="error">{err}</PbcAlert>;

  if (mode === COURSE_ACCESS_MODES.STUDYING) {
    return (
      <PbcSection title={t("pcYourProgress")}>
        <PbcStatGrid
          items={[
            { label: t("pcPending"), value: summary?.pending_count ?? 0, warn: true },
            { label: t("pcWaitingGrade"), value: summary?.waiting_grade_count ?? 0 },
          ]}
        />
        {(summary?.graded_recent || []).length > 0 ? (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 className="pbc-section__title">{t("pcRecentlyGraded")}</h3>
            <PbcList>
              {(summary.graded_recent || []).map((a) => (
                <PbcListItem
                  key={a.activity_id}
                  title={a.title}
                  meta={a.feedback || undefined}
                  badges={
                    <span className="pbc-pill pbc-pill--ok">
                      {t("pcGradePrefix")} {a.grade ?? "—"}
                    </span>
                  }
                />
              ))}
            </PbcList>
          </div>
        ) : null}
      </PbcSection>
    );
  }

  const recent = summary?.recent_activities || [];
  const isTeaching = mode === COURSE_ACCESS_MODES.TEACHING;
  const nextStep = isTeaching ? resolveCourseNextStep(summary) : null;
  const prep = isTeaching ? resolveCoursePrepGuide(summary) : null;

  const nextStepBlock = (() => {
    if (!nextStep) return null;
    if (nextStep.kind === "add_students") {
      return (
        <div className="pbc-next-step" role="status">
          <p className="pbc-next-step__msg">{t("pcNextStepAddStudents")}</p>
          <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" onClick={onGoStudents}>
            {t("pcAddStudents")}
          </button>
        </div>
      );
    }
    if (nextStep.kind === "first_activity") {
      return (
        <div className="pbc-next-step" role="status">
          <p className="pbc-next-step__msg">{t("pcNextStepFirstActivity")}</p>
          <div className="pbc-next-step__actions">
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              onClick={onGoCreateActivity}
            >
              {t("pcCreateActivity")}
            </button>
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              onClick={onGoAssignContent}
            >
              {t("pcAssignContent")}
            </button>
          </div>
        </div>
      );
    }
    if (nextStep.kind === "grade_pending") {
      return (
        <div className="pbc-next-step" role="status">
          <p className="pbc-next-step__msg">
            {t("pcNextStepGradePending").replace("{n}", String(nextStep.pendingCount))}
          </p>
          <button
            type="button"
            className="auth-btn auth-btn--primary auth-btn--sm"
            onClick={onGoSubmissions}
          >
            {t("pcGradeNow")}
          </button>
        </div>
      );
    }
    return null;
  })();

  const prepLabels = {
    course_created: t("pcPrepCourseCreated"),
    students_added: t("pcPrepStudentsAdded"),
    activity_ready: t("pcPrepActivityReady"),
    receiving: t("pcPrepReceiving"),
  };

  return (
    <PbcSection
      title={t("pcClassSummary")}
      description={mode === COURSE_ACCESS_MODES.ADMIN ? t("pcAdminReadOnly") : undefined}
      actions={
        isTeaching && onGoSubmissions ? (
          <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={onGoSubmissions}>
            {t("pcViewSubmissions")}
          </button>
        ) : null
      }
    >
      <PbcStatGrid
        items={[
          { label: t("pcTabStudents"), value: summary?.student_count ?? 0, highlight: true },
          { label: t("pcActivities"), value: summary?.activity_count ?? 0 },
          { label: t("pcTabSubmissions"), value: summary?.submission_count ?? 0 },
          { label: t("pcFilterToGrade"), value: summary?.pending_grade_count ?? 0, warn: true },
          { label: t("pcNotSubmitted"), value: summary?.not_submitted_count ?? 0 },
        ]}
      />

      {nextStepBlock}

      {prep && !prep.established && prep.steps?.length ? (
        <div className="pbc-prep-guide" aria-label={t("pcPrepareCourse")}>
          <h3 className="pbc-section__title">{t("pcPrepareCourse")}</h3>
          <ol className="pbc-prep-guide__list">
            {prep.steps.map((step) => (
              <li key={step.id} className={step.done ? "pbc-prep-guide__done" : ""}>
                <span aria-hidden>{step.done ? "✓" : "○"}</span> {prepLabels[step.id] || step.id}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div style={{ marginTop: "1.25rem" }}>
          <h3 className="pbc-section__title">{t("pcRecentActivity")}</h3>
          <PbcList>
            {recent.map((a) => (
              <PbcListItem
                key={a.activity_id}
                title={a.activity_title}
                meta={`${a.submitted_count ?? 0} ${t("pcTabSubmissions")} · ${a.graded_count ?? 0} ${t("pcStatusGraded")} · ${a.pending_count ?? 0} ${t("pcFilterToGrade")}`}
              />
            ))}
          </PbcList>
        </div>
      ) : (
        <p className="auth-card__muted" style={{ marginTop: "1rem" }}>
          {t("pcNoActivitiesClass")}
        </p>
      )}
    </PbcSection>
  );
}
