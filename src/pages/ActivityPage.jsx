import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AssignedContentSnapshotViewer from "../components/content-editor/AssignedContentSnapshotViewer.jsx";
import AssignedLessonViewer from "../components/content-editor/AssignedLessonViewer.jsx";
import {
  hasSavedLessonDocument,
  legacyBlocksToDocument,
  normalizeLessonDocument,
} from "../components/content-editor/legacyLessonDocument.js";
import SubmissionCodeViewer from "../components/pybotclass/SubmissionCodeViewer.jsx";
import PyBotClassShell, { PyBotClassBreadcrumb } from "../components/pybotclass/PyBotClassShell.jsx";
import {
  PbcAlert,
  PbcCourseHeader,
  PbcEmpty,
  PbcLoading,
  PbcPage,
  PbcSection,
} from "../components/pybotclass/PyBotClassUi.jsx";
import {
  ACTIVITY_ID_QUERY,
  ACTIVITY_LAUNCH_STATE_KEY,
  resolveActivityEditorCode,
} from "../platform/activityIdeSession.js";
import { writeActivityLaunchCache } from "../platform/courseActivityApi.js";
import { fetchActivityProgress } from "../platform/activityProgress.js";
import {
  completeActivityItemProgress,
  deriveProgressAggregates,
  fetchActivityItemProgress,
  listSnapshotItems,
  startActivityItemProgress,
} from "../platform/activityItemProgress.js";
import { useActivityEngagement } from "../platform/useActivityEngagement.js";
import { fetchActivityEngagementSegments } from "../platform/activityEngagementSync.js";
import {
  deriveLearningStatusAggregates,
  resolveActivityPerformance,
} from "../platform/learningStatus.js";
import {
  applyRubricTemplateToActivity,
  clearActivityRubric,
  closeSubmission,
  fetchActiveReopen,
  fetchActivityRubric,
  fetchActivitySubmissions,
  fetchMySubmission,
  fetchSubmissionRubricDraft,
  fetchSubmissionRubricScores,
  getRubricTemplate,
  gradeSubmission,
  reopenSubmissionForStudent,
  requestSubmissionReview,
  saveSubmissionRubricDraft,
  submissionVersionLabel,
  submitActivity,
  upsertActivityRubric,
} from "../platform/activitySubmissions.js";
import {
  ActivityRubricGradeMatrix,
  ActivityRubricStudentResult,
} from "../components/pybotclass/ActivityRubricPanels.jsx";
import ActivityEvaluationSection from "../components/pybotclass/ActivityEvaluationSection.jsx";
import {
  criteriaPayloadFromEditor,
  emptyEvaluationSelection,
  evaluationBaselineKey,
  evaluationChanged,
  selectionFromActivityRubric,
} from "../platform/activityEvaluation.js";
import { isLegacyActivityRubric, rubricPointsCeiling } from "../platform/rubrics.js";
import { getSupabase } from "../supabaseClient.js";
import { t } from "../i18n.js";
import {
  fetchActivityItemSubmissions,
  gradeActivityItemSubmission,
  itemScoresByIdFromSubmissions,
  itemSubmissionVersionLabel,
  submitActivityItem,
} from "../platform/activityItemSubmissions.js";
import {
  canStudentSubmit,
  deriveProcessStatus,
  deriveSubmissionWindow,
  deriveTimeliness,
  sumRubricPoints,
} from "../platform/submissionWorkflow.js";
import {
  connectGoogleClassroom,
  getPendingClassroomTurnIn,
  setPendingClassroomTurnIn,
  clearPendingClassroomTurnIn,
} from "../platform/googleOAuth.js";
import { fetchProfile, getStoredStudentClassroomLink } from "../platform/profileApi.js";
import {
  fetchCachedClassroomSubmissions,
  publishActivityToClassroom,
  sendGradeToClassroom,
  syncClassroomSubmissionsForActivity,
  turnInPybotActivityToClassroom,
  classroomAttachmentLinkItems,
  isSafeHttpUrl,
} from "../platform/activityClassroom.js";
import { fetchAssignedLessonDocument } from "../platform/contentAssignApi.js";
import { listLessonBlocks } from "../platform/contentApi.js";
import { canTeachCourse, fetchMyCourseRole, isCourseStudent } from "../platform/courseRole.js";
import { fetchMyOrgRole } from "../orgRole.js";
import { isSuperAdmin } from "../platformRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { track } from "../telemetry/index.js";

function fmtTs(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("es-AR");
  } catch {
    return String(v);
  }
}

/** Auto-sync Classroom threshold: exactly 2 minutes. */
const CLASSROOM_AUTO_SYNC_MS = 120000;

function classroomSubmissionStateLabel(state) {
  switch (String(state || "").toUpperCase()) {
    case "NEW":
      return t("pcNew");
    case "CREATED":
      return t("pcClassroomStateAssigned");
    case "TURNED_IN":
      return t("pcClassroomStateTurnedIn");
    case "RETURNED":
      return t("pcClassroomStateReturned");
    case "RECLAIMED_BY_STUDENT":
      return t("pcClassroomStateReclaimed");
    default:
      return state ? t("pcClassroomStateInClassroom") : "—";
  }
}

function fmtSyncedRelative(iso) {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return fmtTs(iso);
  const diff = Date.now() - parsed;
  if (diff < 60_000) return t("pcSyncedJustNow");
  if (diff < 3_600_000) {
    const m = Math.max(1, Math.floor(diff / 60_000));
    return t("pcSyncedMinutesAgo").replace("{n}", String(m));
  }
  if (diff < 86_400_000) {
    const h = Math.max(1, Math.floor(diff / 3_600_000));
    return t("pcSyncedHoursAgo").replace("{n}", String(h));
  }
  return fmtTs(iso);
}

function processStatusLabel(processStatus) {
  switch (processStatus) {
    case "en_progreso":
      return t("pcStatusInProgress");
    case "entregado":
      return t("pcStatusSubmitted");
    case "revision_solicitada":
      return t("pcStatusReviewRequested");
    case "reentregado":
      return t("pcStatusResubmitted");
    case "evaluado":
      return t("pcStatusGraded");
    case "cerrado":
      return t("pcStatusClosed");
    default:
      return processStatus || "—";
  }
}

function submissionStatusLabel(status, { version } = {}) {
  const process = deriveProcessStatus({
    status,
    version,
    hasSubmission: Boolean(status),
  });
  if (
    status === "draft" ||
    status === "submitted" ||
    status === "returned" ||
    status === "graded" ||
    status === "closed"
  ) {
    return processStatusLabel(process);
  }
  return status || "—";
}

function studentNextActionMessageI18n(processStatus) {
  switch (processStatus) {
    case "en_progreso":
      return t("pcStudentActionInProgress");
    case "entregado":
    case "reentregado":
      return t("pcStudentActionWaiting");
    case "revision_solicitada":
      return t("pcStudentActionReviewRequested");
    case "evaluado":
      return t("pcStudentActionGraded");
    case "cerrado":
      return t("pcStudentActionClosed");
    default:
      return "";
  }
}

function windowLabel(w) {
  return w === "cerrada" ? t("pcWindowClosed") : t("pcWindowOpen");
}

function timelinessLabel(value) {
  if (value === "a_tiempo") return t("pcOnTime");
  if (value === "tarde") return t("pcLate");
  return null;
}

function classroomGradeSyncUserMessageI18n({ warning, hasFeedback } = {}) {
  const feedbackNote = hasFeedback ? t("pcFeedbackStaysInPyBot") : "";
  if (warning) return `${warning}${feedbackNote}`;
  return `${t("pcGradeSyncedClassroom")}${feedbackNote}`;
}

function classroomTurnInUserMessageI18n(classroomResult) {
  if (!classroomResult || classroomResult.skipped || classroomResult.ok) return null;
  if (classroomResult.needsAdmin || classroomResult.googleReason === "ClassroomApiDisabled") {
    return t("pcClassroomTurnInAdminDisabled");
  }
  const err = String(classroomResult.error || "");
  if (err === "coursework_not_associated_with_developer") {
    return t("pcClassroomTurnInNotAssociated");
  }
  if (err === "classroom_submission_not_found" || err === "submission_not_found") {
    return t("pcClassroomTurnInUpdateFail");
  }
  if (classroomResult.needsConnect) {
    return t("pcClassroomTurnInNeedsAuth");
  }
  const stageHint =
    classroomResult.stage && classroomResult.code
      ? ` (${classroomResult.stage}/${classroomResult.code})`
      : "";
  return `${t("pcClassroomTurnInUpdateFail")}${stageHint}`;
}

function classroomTurnInSuccessMessageI18n(classroomResult) {
  if (!classroomResult || classroomResult.skipped) {
    return t("pcActivitySubmitted");
  }
  if (!classroomResult.ok) return null;
  if (classroomResult.alreadyTurnedIn) {
    return t("pcClassroomTurnInAlreadyThere");
  }
  return t("pcClassroomTurnInBothOk");
}

function classroomCacheIsStale(syncedAt, nowMs = Date.now()) {
  if (!syncedAt) return true;
  const t = Date.parse(syncedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t >= CLASSROOM_AUTO_SYNC_MS;
}

/** Unión docente PyBot + Classroom: una tarjeta por user_id mapeado. */
function buildTeacherDeliveryCards(teacherRows = [], classroomSubs = []) {
  const cards = [];
  const byUserId = new Map();

  for (const row of teacherRows) {
    if (!row?.user_id) continue;
    const card = { key: row.user_id, userId: row.user_id, pybot: row, classroom: null };
    byUserId.set(row.user_id, card);
    cards.push(card);
  }

  for (const cs of classroomSubs) {
    if (cs?.user_id && byUserId.has(cs.user_id)) {
      byUserId.get(cs.user_id).classroom = cs;
      continue;
    }
    const key = cs?.user_id || `classroom:${cs?.id || cs?.userId || cards.length}`;
    cards.push({
      key,
      userId: cs?.user_id || null,
      pybot: null,
      classroom: cs,
    });
  }

  return cards;
}

export default function ActivityPage() {
  const { activityId } = useParams();
  const [searchParams] = useSearchParams();
  const focusStudentId = searchParams.get("alumno") || "";
  const navigate = useNavigate();
  const loginPath = `/actividad/${activityId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [activity, setActivity] = useState(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [classroomCourseId, setClassroomCourseId] = useState(null);
  const [classroomSubs, setClassroomSubs] = useState([]);
  const [classroomSyncedAt, setClassroomSyncedAt] = useState(null);
  const [classroomSyncing, setClassroomSyncing] = useState(false);
  const [classroomSyncErr, setClassroomSyncErr] = useState("");
  const classroomSyncInFlightRef = useRef(false);
  const classroomSyncedAtRef = useRef(null);
  const [progressHint, setProgressHint] = useState("");
  const [savedCode, setSavedCode] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [orgRole, setOrgRole] = useState(null);
  const [courseRole, setCourseRole] = useState(null);
  const [mySubmission, setMySubmission] = useState(null);
  const [teacherRows, setTeacherRows] = useState([]);
  const [teacherHistoryByUser, setTeacherHistoryByUser] = useState(new Map());
  const [profilesById, setProfilesById] = useState(new Map());
  const [viewCode, setViewCode] = useState(null);
  const [viewHistoryId, setViewHistoryId] = useState(null);
  const [gradeDraft, setGradeDraft] = useState({});
  const [rubricCriteria, setRubricCriteria] = useState([]);
  const [activityRubricMeta, setActivityRubricMeta] = useState(null);
  const [rubricDraftBySubmission, setRubricDraftBySubmission] = useState({});
  const [myRubricScores, setMyRubricScores] = useState([]);
  const [reopenActive, setReopenActive] = useState(false);
  const [rubricScoringMode, setRubricScoringMode] = useState("points");
  const [evaluationSelection, setEvaluationSelection] = useState(() => emptyEvaluationSelection());
  const [evaluationBaseline, setEvaluationBaseline] = useState("none");
  const [rubricHasEvaluations, setRubricHasEvaluations] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [needsClassroomConnect, setNeedsClassroomConnect] = useState(false);
  const [classroomLinked, setClassroomLinked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lessonDoc, setLessonDoc] = useState(null);
  const [lessonMeta, setLessonMeta] = useState(null);
  const [lessonErr, setLessonErr] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [itemProgressMap, setItemProgressMap] = useState({});
  const [itemProgressBusy, setItemProgressBusy] = useState(null);
  const [itemSubmissionsById, setItemSubmissionsById] = useState({});
  const [itemTeacherRows, setItemTeacherRows] = useState([]);
  const [itemGradeDraft, setItemGradeDraft] = useState({});
  const [engagementSegments, setEngagementSegments] = useState([]);
  const [superAdmin, setSuperAdmin] = useState(false);
  const focusRowRef = useRef(null);
  const didFocusStudent = useRef(false);

  useEffect(() => {
    classroomSyncedAtRef.current = classroomSyncedAt;
  }, [classroomSyncedAt]);

  const canTeach = canTeachCourse({ orgRole, courseRole });
  const isStudent = isCourseStudent({ courseRole });
  const activityKind = activity?.activity_kind || (activity?.content_snapshot ? "material" : "exercise");
  const isMaterial = activityKind === "material";
  const isCodingActivity = activityKind === "exercise" || activityKind === "task";

  const engagement = useActivityEngagement({
    // Snapshot path or legacy content_lesson_id-only assignment (lesson-document level).
    enabled: Boolean(
      isStudent && activityId && (snapshot || activity?.content_lesson_id),
    ),
    activityId,
    mode: "content",
    activity,
    snapshot,
  });

  // Legacy assigned lessons: content_lesson_id without content_snapshot → lesson-doc only.
  useEffect(() => {
    if (!isStudent || snapshot || !activity?.content_lesson_id) return undefined;
    engagement.setLessonDocument?.({
      id: activity.content_lesson_id,
      unitId: null,
    });
    return () => engagement.leaveTarget?.();
  }, [isStudent, snapshot, activity?.content_lesson_id, engagement]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  useEffect(() => {
    if (activityId) track("activity_open", { feature: "activity" });
  }, [activityId]);

  const load = useCallback(async (opts = {}) => {
    if (!supabase || !activityId || !user) return;
    const preserveActionMsg = Boolean(opts.preserveActionMsg);
    setLoadErr("");
    setLoading(true);
    if (!preserveActionMsg) {
      setActionMsg("");
      setActionErr("");
    }
    let { data: act, error: eAct } = await supabase
      .from("activities")
      .select(
        "id, title, description, starter_code, pybot_lesson_id, content_lesson_id, content_snapshot, content_source_type, content_source_id, activity_kind, course_id, due_at, submission_close_at, max_points, created_at",
      )
      .eq("id", activityId)
      .maybeSingle();

    // Si falta solo submission_close_at, no perder due_at / max_points.
    if (
      eAct &&
      /submission_close_at/i.test(eAct.message || "") &&
      /column|schema cache|does not exist|Could not find/i.test(eAct.message || "")
    ) {
      const mid = await supabase
        .from("activities")
        .select(
          "id, title, description, starter_code, pybot_lesson_id, content_lesson_id, content_snapshot, content_source_type, content_source_id, activity_kind, course_id, due_at, max_points, created_at",
        )
        .eq("id", activityId)
        .maybeSingle();
      act = mid.data;
      eAct = mid.error;
    }

    if (eAct) {
      const fb = await supabase
        .from("activities")
        .select(
          "id, title, description, pybot_lesson_id, course_id, created_at, starter_code, content_lesson_id, due_at, max_points",
        )
        .eq("id", activityId)
        .maybeSingle();
      act = fb.data;
      eAct = fb.error;
    }

    // Campos Classroom (migración 028) — best effort
    if (act?.id) {
      const cw = await supabase
        .from("activities")
        .select("classroom_coursework_id, classroom_coursework_url")
        .eq("id", activityId)
        .maybeSingle();
      if (!cw.error && cw.data) {
        act = { ...act, ...cw.data };
      }
    }

    if (eAct) {
      setLoadErr(eAct.message);
      setLoading(false);
      return;
    }
    if (!act) {
      setLoadErr(t("pcActivityNotFound"));
      setLoading(false);
      return;
    }

    setActivity(act);
    setLessonDoc(null);
    setLessonMeta(null);
    setLessonErr("");
    setSnapshot(act.content_snapshot || null);

    if (!act.content_snapshot && act.content_lesson_id) {
      const { lesson, document, error: lessonLoadErr } = await fetchAssignedLessonDocument(
        act.content_lesson_id,
      );
      if (lessonLoadErr) {
        setLessonErr(lessonLoadErr);
      } else if (lesson) {
        setLessonMeta(lesson);
        if (hasSavedLessonDocument(document)) {
          setLessonDoc(normalizeLessonDocument(document));
        } else {
          const { rows: blocks } = await listLessonBlocks(act.content_lesson_id);
          setLessonDoc(normalizeLessonDocument(legacyBlocksToDocument(blocks)));
        }
      }
    }

    let nextOrgRole = null;
    let nextCourseRole = null;
    let nextOrgId = null;
    let nextClassroomCourseId = null;

    if (act.course_id) {
      const { data: course } = await supabase
        .from("courses")
        .select("title, org_id, classroom_course_id")
        .eq("id", act.course_id)
        .maybeSingle();
      setCourseTitle(course?.title ?? "");
      nextOrgId = course?.org_id ?? null;
      nextClassroomCourseId = course?.classroom_course_id ?? null;
      setClassroomCourseId(nextClassroomCourseId);

      if (nextOrgId) {
        nextOrgRole = await fetchMyOrgRole(supabase, nextOrgId, user.id);
        setOrgRole(nextOrgRole);
      }
      nextCourseRole = await fetchMyCourseRole(supabase, act.course_id, user.id);
      setCourseRole(nextCourseRole);
    }

    const { profile } = await fetchProfile(user.id);
    setSuperAdmin(isSuperAdmin(profile));

    const prog = await fetchActivityProgress(activityId, user.id);
    const launchCode = resolveActivityEditorCode({
      starterCode: act.starter_code,
      savedCode: prog.code,
      launchCode: "",
    });
    if (prog.error) {
      setProgressHint("");
      setSavedCode(false);
    } else if (prog.code && prog.code.length > 0) {
      setSavedCode(true);
      setProgressHint(t("pcProgressHintSaved"));
    } else if (act.starter_code && act.starter_code.length > 0) {
      setSavedCode(false);
      setProgressHint(t("pcProgressHintStarter"));
    } else {
      setSavedCode(false);
      setProgressHint(t("pcProgressHintNone"));
    }

    writeActivityLaunchCache(activityId, launchCode);

    const teach = canTeachCourse({ orgRole: nextOrgRole, courseRole: nextCourseRole });
    const student = isCourseStudent({ courseRole: nextCourseRole });

    // Point 4: pedagogical item progress (distinct from IDE activity_progress)
    // Point 5/6: engagement segments for active-time dimension
    const snap = act.content_snapshot || null;
    const progressUserId =
      isCourseStudent({ courseRole: nextCourseRole })
        ? user.id
        : focusStudentId || user.id;
    let itemSubmissionRowsForProfiles = [];
    if (snap && listSnapshotItems(snap).length > 0) {
      const { map } = await fetchActivityItemProgress(activityId, progressUserId);
      setItemProgressMap(map || {});
      const itemSubs = await fetchActivityItemSubmissions(activityId, {
        userId: student ? user.id : null,
      });
      itemSubmissionRowsForProfiles = itemSubs.rows || [];
      if (student) {
        const byId = {};
        for (const row of itemSubs.rows || []) {
          if (row.snapshot_item_id) byId[row.snapshot_item_id] = row;
        }
        setItemSubmissionsById(byId);
        setItemTeacherRows([]);
      } else if (teach) {
        setItemTeacherRows(itemSubs.rows || []);
        setItemSubmissionsById({});
        const drafts = {};
        for (const row of itemSubs.rows || []) {
          drafts[row.id] = {
            earned: row.earned_points ?? "",
            possible: row.possible_points ?? "",
            feedback: row.feedback ?? "",
          };
        }
        setItemGradeDraft(drafts);
      } else {
        setItemSubmissionsById({});
        setItemTeacherRows([]);
      }
    } else {
      setItemProgressMap({});
      setItemSubmissionsById({});
      setItemTeacherRows([]);
    }
    {
      const eng = await fetchActivityEngagementSegments(activityId, progressUserId);
      setEngagementSegments(eng.rows || []);
    }

    if (student) {
      const sub = await fetchMySubmission(activityId, user.id);
      setMySubmission(sub.submission);

      const { reopen } = await fetchActiveReopen(activityId, user.id);
      setReopenActive(Boolean(reopen?.active));

      if (sub.submission?.id && (sub.submission.status === "graded" || sub.submission.status === "closed")) {
        const { scores } = await fetchSubmissionRubricScores(sub.submission.id);
        setMyRubricScores(scores);
      } else {
        setMyRubricScores([]);
      }

      if (act.classroom_coursework_id && nextClassroomCourseId) {
        const stored = await getStoredStudentClassroomLink(user.id);
        const linked = !!(
          stored?.classroom_student_linked_at ||
          stored?.google_student_refresh_token
        );
        setClassroomLinked(linked);
        setNeedsClassroomConnect(false);
      } else {
        setClassroomLinked(null);
        setNeedsClassroomConnect(false);
      }
    } else {
      setMySubmission(null);
      setMyRubricScores([]);
      setReopenActive(false);
      setClassroomLinked(null);
      setNeedsClassroomConnect(false);
    }

    const { rubric: actRubric, criteria } = await fetchActivityRubric(activityId);
    setActivityRubricMeta(actRubric || null);
    setRubricCriteria(criteria || []);
    setRubricScoringMode(actRubric?.scoring_mode || "points");
    let templateName = null;
    if (actRubric?.source_template_id) {
      const { template } = await getRubricTemplate(actRubric.source_template_id);
      templateName = template?.name || null;
    }
    const selection = selectionFromActivityRubric({
      rubric: actRubric,
      criteria,
      templateName,
    });
    setEvaluationSelection(selection);
    setEvaluationBaseline(evaluationBaselineKey(selection));
    let hasEvals = false;
    if (actRubric?.id) {
      const sb = getSupabase();
      if (sb) {
        const { data: critRows } = await sb
          .from("activity_rubric_criteria")
          .select("id")
          .eq("rubric_id", actRubric.id);
        const ids = (critRows || []).map((c) => c.id);
        if (ids.length) {
          const { data: scores } = await sb
            .from("activity_submission_rubric_scores")
            .select("id")
            .in("criterion_id", ids)
            .limit(1);
          hasEvals = Boolean(scores?.length);
        }
      }
    }
    setRubricHasEvaluations(hasEvals);

    if (teach) {
      const list = await fetchActivitySubmissions(activityId);
      setTeacherRows(list.rows ?? []);
      const hist = new Map();
      for (const row of list.allRows ?? []) {
        if (!row?.user_id) continue;
        const arr = hist.get(row.user_id) || [];
        arr.push(row);
        hist.set(row.user_id, arr);
      }
      setTeacherHistoryByUser(hist);

      const draftMap = {};
      for (const row of list.rows ?? []) {
        if (!row?.id) continue;
        const { drafts } = await fetchSubmissionRubricDraft(row.id);
        if (drafts?.length) {
          const byCrit = {};
          for (const d of drafts) {
            byCrit[d.criterion_id] = {
              level_id: d.level_id || "",
              points: d.points != null ? String(d.points) : "",
              comment: d.comment || "",
            };
          }
          draftMap[row.id] = byCrit;
        } else if (row.status === "graded" || row.status === "closed") {
          const { scores } = await fetchSubmissionRubricScores(row.id);
          if (scores?.length) {
            const byCrit = {};
            for (const s of scores) {
              byCrit[s.criterion_id] = {
                level_id: s.level_id || "",
                points: s.points != null ? String(s.points) : "",
                comment: s.comment || "",
              };
            }
            draftMap[row.id] = byCrit;
          }
        }
      }
      if (Object.keys(draftMap).length) {
        setRubricDraftBySubmission((prev) => ({ ...prev, ...draftMap }));
      }
      // Cache Classroom primero: user_id mapeados entran en la unión de perfiles
      // (Classroom-only sin activity_submission PyBot).
      let classroomRowsForProfiles = [];
      if (act.classroom_coursework_id) {
        try {
          const cached = await fetchCachedClassroomSubmissions(activityId);
          if (cached.ok) {
            classroomRowsForProfiles = cached.rows ?? [];
            setClassroomSubs(classroomRowsForProfiles);
            setClassroomSyncedAt(cached.syncedAt ?? null);
          }
        } catch {
          setClassroomSubs([]);
          setClassroomSyncedAt(null);
        }
      } else {
        setClassroomSubs([]);
        setClassroomSyncedAt(null);
      }

      // profilesById: unión única de teacherRows[].user_id,
      // fetchActivityItemSubmissions(...).rows[].user_id y classroomSubs.user_id.
      // Nunca UUID truncado si existe perfil real; fallback sólo si no hay perfil.
      const ids = [
        ...new Set([
          ...(list.rows ?? []).map((r) => r.user_id), // teacherRows[].user_id
          ...itemSubmissionRowsForProfiles.map((r) => r.user_id), // fetchActivityItemSubmissions(...).rows[].user_id
          ...classroomRowsForProfiles.map((r) => r.user_id), // classroomSubs[].user_id
        ].filter(Boolean)),
      ];
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", ids);
        const map = new Map();
        for (const p of profiles ?? []) map.set(p.id, p);
        setProfilesById(map);
      } else {
        setProfilesById(new Map());
      }
    } else {
      setTeacherRows([]);
      setClassroomSubs([]);
      setClassroomSyncedAt(null);
    }

    setLoading(false);
  }, [supabase, activityId, user, focusStudentId]);

  useEffect(() => {
    if (!authLoading && user) void load();
  }, [authLoading, user, load]);

  const snapshotItems = useMemo(() => listSnapshotItems(snapshot), [snapshot]);
  const itemAggregates = useMemo(
    () => deriveProgressAggregates(snapshotItems, itemProgressMap),
    [snapshotItems, itemProgressMap],
  );
  const activityPerformance = useMemo(
    () =>
      resolveActivityPerformance({
        maxPoints: activity?.max_points,
        grade: mySubmission?.grade,
        status: mySubmission?.status,
        rubricScores: myRubricScores,
        rubricCriteria,
      }),
    [activity?.max_points, mySubmission?.grade, mySubmission?.status, myRubricScores, rubricCriteria],
  );
  const itemScoresById = useMemo(
    () => itemScoresByIdFromSubmissions(Object.values(itemSubmissionsById)),
    [itemSubmissionsById],
  );
  const learningStatus = useMemo(() => {
    if (!snapshotItems.length && !activityPerformance?.assessable) return null;
    return deriveLearningStatusAggregates({
      snapshot,
      snapshotItems,
      progressByItemId: itemProgressMap,
      engagementSegments,
      itemScoresById,
      activityPerformance: activityPerformance?.assessable ? activityPerformance : null,
    });
  }, [
    snapshot,
    snapshotItems,
    itemProgressMap,
    engagementSegments,
    itemScoresById,
    activityPerformance,
  ]);

  // teacherRows + classroomSubs → una tarjeta por alumno mapeado (Classroom-only / PyBot-only).
  const teacherDeliveryCards = useMemo(
    () => buildTeacherDeliveryCards(teacherRows, classroomSubs),
    [teacherRows, classroomSubs],
  );

  const handleStartItem = useCallback(
    async (item) => {
      if (!activityId || !item?.snapshotItemId || !isStudent) return;
      setItemProgressBusy(item.snapshotItemId);
      const { ok, row } = await startActivityItemProgress({
        activityId,
        snapshotItemId: item.snapshotItemId,
        itemType: item.type,
        sourceItemId: item.sourceItemId,
      });
      if (ok) {
        setItemProgressMap((prev) => ({
          ...prev,
          [item.snapshotItemId]: row || {
            snapshot_item_id: item.snapshotItemId,
            status: "in_progress",
          },
        }));
      }
      setItemProgressBusy(null);
    },
    [activityId, isStudent],
  );

  const handleCompleteItem = useCallback(
    async (item, metadata) => {
      if (!activityId || !item?.snapshotItemId || !isStudent) return;
      setItemProgressBusy(item.snapshotItemId);
      const { ok, row } = await completeActivityItemProgress({
        activityId,
        snapshotItemId: item.snapshotItemId,
        itemType: item.type,
        sourceItemId: item.sourceItemId,
        metadata: metadata || {},
      });
      if (ok) {
        setItemProgressMap((prev) => ({
          ...prev,
          [item.snapshotItemId]: row || {
            snapshot_item_id: item.snapshotItemId,
            status: "completed",
          },
        }));
      }
      setItemProgressBusy(null);
    },
    [activityId, isStudent],
  );

  const handleSubmitItem = useCallback(
    async (item, { responseText } = {}) => {
      if (!activityId || !item?.snapshotItemId || !isStudent) return false;
      setItemProgressBusy(item.snapshotItemId);
      setActionErr("");
      const {
        ok,
        submission,
        error,
        progressUpdated,
        progressRow,
        progressError,
      } = await submitActivityItem({
        activityId,
        item,
        responseText: responseText || "",
      });
      if (!ok) {
        setActionErr(error || t("pcItemSubmitFail"));
        setItemProgressBusy(null);
        return false;
      }
      setItemSubmissionsById((prev) => ({
        ...prev,
        [item.snapshotItemId]: submission,
      }));
      if (progressUpdated) {
        setItemProgressMap((prev) => ({
          ...prev,
          [item.snapshotItemId]:
            progressRow || {
              ...(prev[item.snapshotItemId] || {}),
              snapshot_item_id: item.snapshotItemId,
              status: "completed",
            },
        }));
      } else if (progressError) {
        setActionErr(t("pcItemSubmitProgressSyncFail"));
      }
      setItemProgressBusy(null);
      return true;
    },
    [activityId, isStudent],
  );

  const onGradeItemSubmission = async (submissionId) => {
    if (busy) return;
    const draft = itemGradeDraft[submissionId] || {};
    const earnedRaw = draft.earned;
    const possibleRaw = draft.possible;
    const earned =
      earnedRaw === "" || earnedRaw == null ? null : Number(earnedRaw);
    const possible =
      possibleRaw === "" || possibleRaw == null ? null : Number(possibleRaw);
    if (earned != null && (Number.isNaN(earned) || earned < 0)) {
      setActionErr(t("pcPointsEarnedMin"));
      return;
    }
    if (possible != null && (Number.isNaN(possible) || possible <= 0)) {
      setActionErr(t("pcPointsPossibleMin"));
      return;
    }
    if (earned != null && possible == null) {
      setActionErr(t("pcPointsPossibleRequired"));
      return;
    }
    if (earned != null && possible != null && earned > possible) {
      setActionErr(t("pcPointsEarnedExceed"));
      return;
    }
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await gradeActivityItemSubmission({
      submissionId,
      earnedPoints: earned,
      possiblePoints: possible,
      feedback: draft.feedback || null,
    });
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || t("pcItemGradeFail"));
      return;
    }
    setActionMsg(t("pcItemGradeSaved"));
    await load({ preserveActionMsg: true });
  };

  // Deep-link desde tab Entregas: ?alumno= → abrir código de esa entrega
  useEffect(() => {
    didFocusStudent.current = false;
  }, [focusStudentId, activityId]);

  useEffect(() => {
    if (loading || !canTeach || !focusStudentId || didFocusStudent.current) return;
    const row = teacherRows.find((r) => r.user_id === focusStudentId);
    if (!row) return;
    didFocusStudent.current = true;
    setViewCode(row.id);
    setViewHistoryId(null);
    requestAnimationFrame(() => {
      focusRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading, canTeach, focusStudentId, teacherRows]);

  // Resume turnIn post-OAuth (sin re-submit)
  useEffect(() => {
    if (authLoading || loading || !user || !activityId || !isStudent) return;
    const pending = getPendingClassroomTurnIn();
    if (!pending) return;
    if (pending.activityId !== activityId || pending.userId !== user.id) return;

    let cancelled = false;
    (async () => {
      clearPendingClassroomTurnIn();
      setBusy(true);
      setActionErr("");
      setActionMsg(t("pcCompletingClassroomTurnIn"));
      try {
        const cr = await turnInPybotActivityToClassroom(activityId);
        if (cancelled) return;
        await load({ preserveActionMsg: true });
        if (cr?.needsConnect && !cr?.needsAdmin) {
          setActionMsg(classroomTurnInUserMessageI18n(cr) || t("pcClassroomTurnInFail"));
          return;
        }
        const okMsg = classroomTurnInSuccessMessageI18n(cr);
        const failMsg = classroomTurnInUserMessageI18n(cr);
        setActionMsg(failMsg || okMsg || t("pcActivitySubmitted"));
      } catch (ex) {
        if (cancelled) return;
        setActionErr(ex?.message || t("pcClassroomTurnInFail"));
        setActionMsg("");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, loading, user, activityId, isStudent, load]);

  const openPyBot = () => {
    if (!activityId || !activity || !user) return;
    void fetchActivityProgress(activityId, user.id).then((prog) => {
      const launchCode = resolveActivityEditorCode({
        starterCode: activity.starter_code,
        savedCode: prog.code,
        launchCode: "",
      });
      writeActivityLaunchCache(activityId, launchCode);
      navigate(`/?${ACTIVITY_ID_QUERY}=${encodeURIComponent(activityId)}`, {
        state: { [ACTIVITY_LAUNCH_STATE_KEY]: launchCode },
      });
    });
  };

  const onPublishClassroom = async () => {
    if (!activity || !classroomCourseId || !user || busy) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await publishActivityToClassroom({
      activity,
      classroomCourseId,
      userId: user.id,
    });
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || t("pcPublishClassroomFail"));
      return;
    }
    setActionMsg(r.alreadyPublished ? t("pcAlreadyPublishedClassroom") : t("pcPublishedClassroom"));
    await load();
  };

  const runClassroomSync = useCallback(
    async ({ manual = false } = {}) => {
      if (!activity?.classroom_coursework_id || !classroomCourseId || !user) return;
      if (classroomSyncInFlightRef.current) return;
      classroomSyncInFlightRef.current = true;
      setClassroomSyncing(true);
      if (manual) setClassroomSyncErr("");
      try {
        const r = await syncClassroomSubmissionsForActivity({
          activityId: activity.id,
          classroomCourseId,
          courseWorkId: activity.classroom_coursework_id,
          userId: user.id,
        });
        if (!r.ok) {
          // Conservar classroomSubs cacheados; no OAuth ni redirect en auto-sync.
          const msg = r.error || t("pcClassroomSyncError");
          const friendly = /guardar|persist|forbidden|invalid_rows|missing_activity/i.test(
            String(msg),
          )
            ? t("pcClassroomSyncPersistFail")
            : msg;
          setClassroomSyncErr(friendly);
          return;
        }
        setClassroomSubs(r.rows ?? []);
        setClassroomSyncedAt(r.syncedAt ?? new Date().toISOString());
        setClassroomSyncErr("");
        // Sync exitoso: estado compacto (sin banner actionMsg).
      } finally {
        classroomSyncInFlightRef.current = false;
        setClassroomSyncing(false);
      }
    },
    [activity?.classroom_coursework_id, activity?.id, classroomCourseId, user],
  );

  const onSyncClassroom = useCallback(() => {
    void runClassroomSync({ manual: true });
  }, [runClassroomSync]);

  // Auto-sync en background al abrir (cache ausente o >= 2 min). Sin polling continuo.
  useEffect(() => {
    if (!canTeach || !activity?.classroom_coursework_id || !classroomCourseId || !user) return;
    if (loading) return;
    if (!classroomCacheIsStale(classroomSyncedAtRef.current)) return;
    void runClassroomSync({ manual: false });
  }, [
    canTeach,
    activity?.classroom_coursework_id,
    classroomCourseId,
    user,
    loading,
    runClassroomSync,
  ]);

  // Revalidación al volver a pestaña/ventana (visibilitychange / focus).
  useEffect(() => {
    if (!canTeach || !activity?.classroom_coursework_id || !classroomCourseId || !user) {
      return undefined;
    }
    const maybeSync = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (!classroomCacheIsStale(classroomSyncedAtRef.current)) return;
      void runClassroomSync({ manual: false });
    };
    window.addEventListener("focus", maybeSync);
    document.addEventListener("visibilitychange", maybeSync);
    return () => {
      window.removeEventListener("focus", maybeSync);
      document.removeEventListener("visibilitychange", maybeSync);
    };
  }, [
    canTeach,
    activity?.classroom_coursework_id,
    classroomCourseId,
    user,
    runClassroomSync,
  ]);

  const resolveClassroomSubmissionId = async (row) => {
    let classroomSubmissionId = row.classroom_submission_id || null;
    if (!classroomSubmissionId) {
      const byUserId = classroomSubs.find((cs) => cs.user_id && cs.user_id === row.user_id);
      if (byUserId?.id) classroomSubmissionId = byUserId.id;
    }
    if (!classroomSubmissionId && activity?.course_id) {
      const { data: cm } = await supabase
        .from("course_members")
        .select("classroom_user_id")
        .eq("course_id", activity.course_id)
        .eq("user_id", row.user_id)
        .maybeSingle();
      const googleUid = cm?.classroom_user_id;
      if (googleUid) {
        const cached = await fetchCachedClassroomSubmissions(activity.id);
        const fromDb = (cached.rows || []).find((cs) => cs.userId === googleUid);
        classroomSubmissionId = fromDb?.id || null;
        if (!classroomSubmissionId) {
          const found = classroomSubs.find((cs) => cs.userId === googleUid);
          classroomSubmissionId = found?.id || null;
        }
      }
    }
    return classroomSubmissionId;
  };

  const onSendGradeClassroom = async (row) => {
    if (!activity?.classroom_coursework_id || !classroomCourseId || !user || busy) return;
    const classroomSubmissionId = await resolveClassroomSubmissionId(row);
    if (!classroomSubmissionId) {
      setActionErr(t("pcClassroomSubmissionNotFound"));
      return;
    }
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await sendGradeToClassroom({
      submission: row,
      activity,
      classroomCourseId,
      courseWorkId: activity.classroom_coursework_id,
      classroomSubmissionId,
      userId: user.id,
    });
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || t("pcSendGradeClassroomFail"));
      return;
    }
    setActionMsg(
      classroomGradeSyncUserMessageI18n({
        warning: r.warning || null,
        hasFeedback: Boolean(row.feedback) && r.feedbackSynced !== true,
      }),
    );
    await load({ preserveActionMsg: true });
  };

  const onSubmit = async () => {
    if (!activityId || !user || busy) return;
    if (!window.confirm(t("pcConfirmSubmitActivity"))) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    setNeedsClassroomConnect(false);
    const prog = await fetchActivityProgress(activityId, user.id);
    const code = prog.code ?? activity?.starter_code ?? "";
    const r = await submitActivity(activityId, code);
    if (!r.ok) {
      setBusy(false);
      const msg =
        r.error === "submissions_closed"
          ? t("pcSubmissionsClosedAskReopen")
          : r.error || t("pcSubmitFail");
      setActionErr(msg);
      return;
    }
    await load({ preserveActionMsg: true });
    const cr = r.classroom;
    if (cr?.ok === false && cr?.needsConnect && !cr?.needsAdmin) {
      setPendingClassroomTurnIn({
        activityId,
        userId: user.id,
        returnPath: `/actividad/${activityId}`,
      });
      setActionMsg(
        classroomTurnInUserMessageI18n(cr) || t("pcSubmittedAuthorizeClassroom"),
      );
      setBusy(false);
      void connectGoogleClassroom(`/actividad/${activityId}`, { mode: "student" });
      return;
    }
    setBusy(false);
    const lateNote = r.submission?.late;
    const okMsg = classroomTurnInSuccessMessageI18n(cr);
    const failMsg = classroomTurnInUserMessageI18n(cr);
    setActionMsg(failMsg || okMsg || (lateNote ? t("pcActivitySubmittedLate") : t("pcActivitySubmitted")));
  };

  const onRequestReview = async (submissionId) => {
    if (busy) return;
    const draft = gradeDraft[submissionId] || {};
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await requestSubmissionReview(submissionId, draft.feedback || null);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || t("pcRequestReviewFail"));
      return;
    }
    setActionMsg(t("pcRequestReviewOk"));
    await load({ preserveActionMsg: true });
  };

  const onGrade = async (submissionId) => {
    if (busy) return;
    const draft = { ...(gradeDraft[submissionId] || {}) };
    const row = teacherRows.find((r) => r.id === submissionId);
    setBusy(true);
    setActionErr("");
    setActionMsg("");

    let rubricScores = null;
    const scoringMode = activityRubricMeta?.scoring_mode || rubricScoringMode || "points";
    const legacy = isLegacyActivityRubric(activityRubricMeta, rubricCriteria);
    if (rubricCriteria.length > 0) {
      const rd = rubricDraftBySubmission[submissionId] || {};
      if (legacy) {
        rubricScores = rubricCriteria.map((c) => ({
          criterion_id: c.id,
          points: Number(rd[c.id]?.points ?? 0),
          comment: rd[c.id]?.comment || null,
        }));
        draft.grade = sumRubricPoints(rubricScores);
      } else {
        rubricScores = rubricCriteria.map((c) => ({
          criterion_id: c.id,
          level_id: rd[c.id]?.level_id || null,
          comment: rd[c.id]?.comment || null,
        }));
        // Server derives points; client must not invent qualitative totals.
        if (scoringMode === "qualitative") {
          draft.grade = null;
        }
      }
    }

    const r = await gradeSubmission(
      submissionId,
      draft.grade,
      draft.feedback,
      rubricScores,
    );
    if (!r.ok) {
      setBusy(false);
      setActionErr(
        r.error === "rubric_max_mismatch"
          ? t("pcRubricMaxMustMatch").replace("{n}", String(activity?.max_points ?? ""))
          : r.error === "incomplete_rubric"
            ? t("pcCompleteLevelsBeforeGrade")
            : r.error || t("pcSaveEvaluationFail"),
      );
      return;
    }

    let msg = t("pcEvaluationSaved");
    if (activity?.classroom_coursework_id && classroomCourseId && row && r.result?.grade != null) {
      const gradedRow = {
        ...row,
        grade: r.result?.grade ?? Number(draft.grade),
        feedback: draft.feedback,
      };
      const classroomSubmissionId = await resolveClassroomSubmissionId(gradedRow);
      if (classroomSubmissionId) {
        const sync = await sendGradeToClassroom({
          submission: gradedRow,
          activity,
          classroomCourseId,
          courseWorkId: activity.classroom_coursework_id,
          classroomSubmissionId,
          userId: user.id,
        });
        if (sync.ok) {
          msg = classroomGradeSyncUserMessageI18n({
            warning: sync.warning || null,
            hasFeedback: Boolean(draft.feedback) && sync.feedbackSynced !== true,
          });
        } else {
          msg = t("pcEvaluationSavedClassroomPending").replace("{error}", sync.error || t("pcErrorWord"));
        }
      } else {
        msg = t("pcEvaluationSavedClassroomMissing");
      }
    }

    setBusy(false);
    setActionMsg(msg);
    await load({ preserveActionMsg: true });
  };

  const onSaveRubricDraft = async (submissionId) => {
    if (busy) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const rd = rubricDraftBySubmission[submissionId] || {};
    const legacy = isLegacyActivityRubric(activityRubricMeta, rubricCriteria);
    const payload = rubricCriteria.map((c) => ({
      criterion_id: c.id,
      level_id: legacy ? null : rd[c.id]?.level_id || null,
      points: legacy && rd[c.id]?.points !== "" && rd[c.id]?.points != null
        ? Number(rd[c.id].points)
        : null,
      comment: rd[c.id]?.comment || null,
    }));
    const r = await saveSubmissionRubricDraft(submissionId, payload);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || t("pcSaveDraftFail"));
      return;
    }
    setActionMsg(t("pcRubricDraftSaved"));
  };

  const onCloseSubmission = async (submissionId) => {
    if (busy) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await closeSubmission(submissionId);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || t("pcCloseFail"));
      return;
    }
    setActionMsg(t("pcCorrectionClosed"));
    await load({ preserveActionMsg: true });
  };

  const onReopen = async (userId) => {
    if (busy || !activityId) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await reopenSubmissionForStudent(activityId, userId);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || t("pcReopenFail"));
      return;
    }
    setActionMsg(t("pcReopenedForStudentMsg"));
    await load({ preserveActionMsg: true });
  };

  const persistEvaluation = async (next) => {
    if (busy || !activityId || rubricHasEvaluations) return;
    if (!evaluationChanged(evaluationBaseline, next)) {
      setEvaluationSelection(next);
      return;
    }
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    // Points rubrics: align activity max_points to factual ceiling before apply/upsert
    // (same lock semantics as ActivityForm). Qualitative never invents/erases max.
    // Failure-safe: keep original max; verify max update; restore on rubric failure.
    const originalMax = activity?.max_points ?? null;
    let maxUpdatedTo = null;
    if (next?.mode && next.mode !== "none" && next.scoringMode === "points" && supabase) {
      const ceilingPayload = criteriaPayloadFromEditor(next.criteria, "points");
      const ceiling = rubricPointsCeiling(ceilingPayload);
      if (ceiling != null && Number.isFinite(ceiling)) {
        const { error: maxErr } = await supabase
          .from("activities")
          .update({ max_points: ceiling })
          .eq("id", activityId);
        if (maxErr) {
          setBusy(false);
          setActionErr(maxErr.message || t("pcRubricApplyFail"));
          return;
        }
        maxUpdatedTo = ceiling;
      }
    }
    let r;
    if (!next || next.mode === "none") {
      r = await clearActivityRubric(activityId);
    } else if (next.mode === "template" && next.templateId) {
      r = await applyRubricTemplateToActivity(activityId, next.templateId);
    } else if (next.mode === "oneoff") {
      const criteria = criteriaPayloadFromEditor(next.criteria, next.scoringMode);
      r = await upsertActivityRubric(activityId, criteria, next.scoringMode);
    } else {
      setBusy(false);
      return;
    }
    if (!r.ok) {
      // ActivityPage.persistEvaluation: if activities.max_points was updated then rubric
      // apply/upsert failed, restore via supabase.from("activities").update({ max_points: originalMax })
      // and capture the rollback result (must not ignore restoreErr).
      let restoreFailed = false;
      if (maxUpdatedTo != null && supabase) {
        const { error: restoreErr } = await supabase.from("activities").update({ max_points: originalMax }).eq("id", activityId);
        restoreFailed = Boolean(restoreErr);
      }
      setBusy(false);
      if (restoreFailed) {
        setActionErr(
          t("pcRubricMaxRestoreFail"),
        );
      } else {
        setActionErr(
          r.error === "rubric_has_evaluations"
            ? t("pcRubricHasEvaluationsLocked")
            : r.error === "rubric_max_mismatch"
              ? t("pcRubricMaxMustMatch").replace("{n}", String(originalMax))
              : r.error || t("pcRubricApplyFail"),
        );
      }
      await load({ preserveActionMsg: true });
      return;
    }
    setBusy(false);
    setActionMsg(t("pcRubricApplyOk"));
    await load({ preserveActionMsg: true });
  };

  const onEvaluationChange = (next) => {
    // Stage one-off edits locally; persist templates/clear immediately.
    if (next?.mode === "oneoff") {
      const prev = evaluationSelection;
      const onlyLocalEdit =
        prev?.mode === "oneoff" || evaluationBaseline.startsWith("oneoff:");
      setEvaluationSelection(next);
      if (onlyLocalEdit && prev?.mode === "oneoff") return;
      // Switching into one-off from none/template: wait for explicit save.
      return;
    }
    void persistEvaluation(next);
  };

  const onCommitOneOff = (selection) => {
    void persistEvaluation(selection);
  };

  if (authLoading) {
    return (
      <main className="dash-root dash-root--center">
        <PbcLoading label={t("pcLoadingActivity")} />
      </main>
    );
  }

  if (!user) return null;

  if (loading) {
    return (
      <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
        <PbcPage>
          <PbcLoading label={t("pcLoadingActivity")} />
        </PbcPage>
      </PyBotClassShell>
    );
  }

  const courseHref = activity?.course_id
    ? `/dashboard/classes/${activity.course_id}`
    : "/dashboard/classes";
  const entregasHref = activity?.course_id
    ? `/dashboard/classes/${activity.course_id}?tab=entregas`
    : "/dashboard/classes";
  const actividadesHref = activity?.course_id
    ? `/dashboard/classes/${activity.course_id}?tab=actividades`
    : "/dashboard/classes";

  const breadcrumbItems = [];
  if (activity?.course_id) {
    breadcrumbItems.push({ label: courseTitle || t("pcSelectCourse"), href: courseHref });
    if (canTeach) {
      breadcrumbItems.push({ label: t("pcSubmissions"), href: entregasHref });
    }
  }
  breadcrumbItems.push({ label: activity?.title || t("pcActivity") });

  const myProcess = deriveProcessStatus({
    status: mySubmission?.status,
    version: mySubmission?.version,
    hasSubmission: Boolean(mySubmission),
  });
  const myTimeliness = deriveTimeliness({
    submittedAt: mySubmission?.submitted_at,
    dueAt: activity?.due_at,
  });
  const myWindow = deriveSubmissionWindow({
    closeAt: activity?.submission_close_at,
    reopenActive,
  });
  const studentCanSubmit =
    isStudent &&
    isCodingActivity &&
    canStudentSubmit({
      processStatus: myProcess,
      windowStatus: myWindow,
      reopenActive,
    });

  if (loadErr) {
    return (
      <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
        <PbcPage>
          <PyBotClassBreadcrumb items={[{ label: t("pcActivity") }]} />
          <PbcCourseHeader title={t("pcActivity")} />
          <PbcAlert variant="error">{loadErr}</PbcAlert>
          <div className="pbc-footer-links">
            <Link to="/dashboard/classes" className="auth-link">
              {t("pcMyClassesBack")}
            </Link>
          </div>
        </PbcPage>
      </PyBotClassShell>
    );
  }

  return (
    <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
      <PbcPage>
        <PyBotClassBreadcrumb items={breadcrumbItems} />

        <PbcCourseHeader
          title={activity?.title || t("pcActivity")}
          orgName={courseTitle || undefined}
          roleLabel={canTeach ? t("pcTeacher") : isStudent ? t("pcStudent") : undefined}
          classroomLinked={!!activity?.classroom_coursework_id}
        />

        {profileError ? <PbcAlert variant="error">{profileError}</PbcAlert> : null}
        {actionErr ? <PbcAlert variant="error">{actionErr}</PbcAlert> : null}
        {actionMsg ? <PbcAlert variant="info">{actionMsg}</PbcAlert> : null}

        <PbcSection
          className="pbc-activity-overview"
          title={t("pcDetail")}
          description={canTeach ? undefined : t("pcActivityOverviewDesc")}
          actions={
            <div className="pbc-activity-actions">
              {isCodingActivity ? (
                <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" onClick={openPyBot}>
                  {t("pcOpenPyBot")}
                </button>
              ) : null}
              {isStudent && isCodingActivity ? (
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--sm"
                  disabled={busy || !studentCanSubmit}
                  onClick={() => void onSubmit()}
                >
                  {busy ? t("pcSubmitting") : t("pcSubmitActivity")}
                </button>
              ) : null}
              <Link to={courseHref} className="auth-btn auth-btn--ghost auth-btn--sm">
                {t("pcBackToCourse")}
              </Link>
            </div>
          }
        >
          {canTeach ? (
            <div className="pbc-activity-meta" aria-label={t("pcActivitySettingsAria")}>
              {activity?.due_at ? (
                <p className="auth-card__muted" style={{ margin: 0 }}>
                  {t("pcDueDateColon").replace("{date}", fmtTs(activity.due_at))}
                </p>
              ) : null}
              {activity?.submission_close_at ? (
                <p className="auth-card__muted" style={{ margin: 0 }}>
                  {t("pcCloseColon").replace("{date}", fmtTs(activity.submission_close_at))}
                </p>
              ) : null}
              {activity?.max_points != null ? (
                <p className="auth-card__muted" style={{ margin: 0 }}>
                  {t("pcMaxPointsColon").replace("{n}", String(activity.max_points))}
                </p>
              ) : activity?.course_id ? (
                <p className="auth-card__muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                  {t("pcDefineMaxInActivities").split("{link}")[0]}
                  <Link to={actividadesHref} className="auth-link">
                    {t("pcActivities")}
                  </Link>
                  {t("pcDefineMaxInActivities").split("{link}")[1]}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="pbc-activity-meta">
              <p className="auth-card__muted" style={{ margin: 0 }}>
                {activity?.due_at
                  ? t("pcDueDateColon").replace("{date}", fmtTs(activity.due_at))
                  : t("pcNoDueDate")}
                {activity?.submission_close_at
                  ? ` · ${t("pcCloseColon").replace("{date}", fmtTs(activity.submission_close_at))}`
                  : ` · ${t("pcNoSubmissionClose")}`}
                {activity?.max_points != null
                  ? ` · ${t("pcMaxShortColon").replace("{n}", String(activity.max_points))}`
                  : ""}
              </p>
              <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                {t("pcWindow")}: <strong>{windowLabel(myWindow)}</strong>
                {myTimeliness !== "sin_dato" ? (
                  <>
                    {" "}
                    · {t("pcTimeliness")}: <strong>{timelinessLabel(myTimeliness)}</strong>
                  </>
                ) : null}
              </p>
            </div>
          )}

          {isStudent && activity?.classroom_coursework_id && classroomCourseId ? (
            <div className="pbc-activity-classroom-hint">
              {classroomLinked ? (
                <span className="auth-card__muted">{t("pcClassroomAccountLinked")}</span>
              ) : (
                <p className="auth-card__muted" style={{ margin: 0 }}>
                  {t("pcClassroomActivityHint")}
                </p>
              )}
            </div>
          ) : null}

          {activity?.description ? (
            <p className="pbc-activity-description">{activity.description}</p>
          ) : (
            <p className="auth-card__muted">{t("pcNoDescription")}</p>
          )}

          {activity?.content_snapshot || activity?.content_lesson_id ? (
            <p className="auth-card__muted">
              {isMaterial ? t("pcMaterialFromMyContent") : t("pcActivityFromMyContent")}
              {activity?.content_snapshot?.title ? `: ${activity.content_snapshot.title}` : ""}
              {lessonMeta?.title && !activity?.content_snapshot ? `: ${lessonMeta.title}` : ""}
            </p>
          ) : !canTeach && activity?.pybot_lesson_id ? (
            <p className="auth-card__muted">
              {t("pcPyBotLessonRef")}: <code>{activity.pybot_lesson_id}</code>
            </p>
          ) : null}

          {lessonErr ? (
            <PbcAlert variant="error">
              {t("pcLessonDocLoadFail").replace("{error}", lessonErr)}
            </PbcAlert>
          ) : null}

          {snapshot ? (
            <section className="pbc-activity-lesson" aria-label={t("pcAssignedContentAria")}>
              <h2 className="pbc-activity-lesson__title">
                {isMaterial ? t("pcMaterial") : activityKind === "task" ? t("pcTask") : t("pcExercise")}
              </h2>
              <AssignedContentSnapshotViewer
                snapshot={snapshot}
                aggregates={snapshotItems.length ? itemAggregates : null}
                learningStatus={isStudent ? learningStatus : null}
                progressByItemId={itemProgressMap}
                interactive={Boolean(isStudent && snapshotItems.length)}
                busyId={itemProgressBusy}
                onStartItem={handleStartItem}
                onCompleteItem={handleCompleteItem}
                onSubmitItem={handleSubmitItem}
                itemSubmissionsById={itemSubmissionsById}
                engagement={isStudent ? engagement : null}
              />
            </section>
          ) : lessonDoc && activity?.content_lesson_id ? (
            <section
              className="pbc-activity-lesson"
              aria-label={t("pcLessonContentAria")}
              ref={isStudent ? engagement.setSurfaceRef : undefined}
              onPointerDown={
                isStudent
                  ? () => {
                      engagement.activateLessonDocument?.();
                    }
                  : undefined
              }
            >
              <h2 className="pbc-activity-lesson__title">{t("pcLesson")}</h2>
              <AssignedLessonViewer
                key={activity.content_lesson_id}
                lessonId={activity.content_lesson_id}
                initialContent={lessonDoc}
              />
            </section>
          ) : null}

          {!isMaterial && !canTeach && progressHint ? (
            <p className="auth-card__muted">{progressHint}</p>
          ) : null}

          {isStudent && isCodingActivity ? (
            <div className="pbc-activity-my-submission">
              <p className="auth-card__muted" style={{ margin: 0 }}>
                {t("pcStatus")}: <strong>{processStatusLabel(myProcess)}</strong>
                {submissionVersionLabel(mySubmission?.version)
                  ? ` · ${submissionVersionLabel(mySubmission.version)}`
                  : null}
                {mySubmission?.submitted_at ? ` · ${fmtTs(mySubmission.submitted_at)}` : null}
              </p>
              <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                {studentNextActionMessageI18n(myProcess)}
              </p>
              {!studentCanSubmit && myWindow === "cerrada" ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  {t("pcSubmissionsClosed")}
                </p>
              ) : null}
              {myProcess === "revision_solicitada" && mySubmission?.feedback ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  {t("pcTeacherRequestedReviewFeedback")} {mySubmission.feedback}
                </p>
              ) : null}
              {(myProcess === "evaluado" || myProcess === "cerrado") && mySubmission?.grade != null ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  {t("pcGradePrefix")}: <strong>{mySubmission.grade}</strong>
                  {activity?.max_points != null ? ` / ${activity.max_points}` : null}
                </p>
              ) : null}
              {(myProcess === "evaluado" || myProcess === "cerrado") &&
              activityRubricMeta?.scoring_mode === "qualitative" &&
              myRubricScores.length > 0 ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  {t("pcQualitativeNoNumeric")}
                </p>
              ) : null}
              {(myProcess === "evaluado" || myProcess === "cerrado") && mySubmission?.feedback ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  {t("pcFeedbackLabel")}: {mySubmission.feedback}
                </p>
              ) : null}
              {(myProcess === "evaluado" || myProcess === "cerrado") &&
              rubricCriteria.length > 0 &&
              myRubricScores.length > 0 ? (
                <ActivityRubricStudentResult
                  criteria={rubricCriteria}
                  scores={myRubricScores}
                  scoringMode={activityRubricMeta?.scoring_mode || "points"}
                  grade={mySubmission?.grade}
                  maxPoints={activity?.max_points}
                  feedback={null}
                />
              ) : null}
            </div>
          ) : null}

          {isCodingActivity ? (
            canTeach ? null : (
              <p className="auth-card__muted">
                {savedCode
                  ? t("pcAutosaveHint")
                  : activity?.starter_code
                    ? t("pcStarterCodeHint")
                    : t("pcWorkInIdeHint")}
              </p>
            )
          ) : (
            <p className="auth-card__muted">{t("pcMaterialReadOnly")}</p>
          )}
        </PbcSection>

        {canTeach ? (
          <PbcSection title={t("pcEvaluation")}>
            <ActivityEvaluationSection
              compact
              value={evaluationSelection}
              onChange={onEvaluationChange}
              onCommitOneOff={onCommitOneOff}
              commitOneOffBusy={busy}
              disabled={busy}
              hasEvaluations={rubricHasEvaluations}
            />
          </PbcSection>
        ) : null}

        {canTeach ? (
          <PbcSection title={t("pcSubmissions")} className="pbc-activity-deliveries">
            {classroomCourseId ? (
              /* Compact strip replaces former technical "Google Classroom" block title. */
              <div className="pbc-activity-classroom-status" role="status">
                <div className="pbc-activity-classroom-status__main">
                  {activity?.classroom_coursework_id ? (
                    classroomSyncing || (!classroomSyncedAt && !classroomSyncErr) ? (
                      <span className="pbc-activity-classroom-status__label">{t("pcSyncing")}</span>
                    ) : classroomSyncErr ? (
                      <span className="pbc-activity-classroom-status__label">
                        {t("pcSyncFailedShort")}
                        <button
                          type="button"
                          className="auth-btn auth-btn--ghost auth-btn--sm"
                          disabled={classroomSyncing}
                          onClick={() => void onSyncClassroom()}
                        >
                          {t("pcRetry")}
                        </button>
                      </span>
                    ) : (
                      <span className="pbc-activity-classroom-status__label">
                        {t("pcSynced")}
                        {classroomSyncedAt
                          ? ` · ${fmtSyncedRelative(classroomSyncedAt)}`
                          : ""}
                      </span>
                    )
                  ) : (
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      disabled={busy}
                      onClick={() => void onPublishClassroom()}
                    >
                      {t("pcPublishToClassroom")}
                    </button>
                  )}
                </div>
                {activity?.classroom_coursework_id ? (
                  <div className="pbc-activity-classroom-status__actions">
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      disabled={classroomSyncing}
                      onClick={() => void onSyncClassroom()}
                    >
                      {t("pcRefresh")}
                    </button>
                    {activity.classroom_coursework_url ? (
                      <a
                        className="auth-link pbc-activity-classroom-status__link"
                        href={activity.classroom_coursework_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("pcOpenActivityInClassroom")}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {teacherDeliveryCards.length === 0 ? (
              <PbcEmpty
                title={t("pcNoSubmissionsYet")}
                description={t("pcNoSubmissionsYetDesc")}
              />
            ) : (
              <ul className="pbc-list pbc-activity-submissions">
                {teacherDeliveryCards.map((card) => {
                  const row = card.pybot;
                  const cs = card.classroom;
                  const profile = card.userId ? profilesById.get(card.userId) : null;
                  const identity =
                    profile?.display_name ||
                    profile?.email ||
                    (row ? t("pcStudent") : t("pcClassroomStudent"));
                  const isFocused = focusStudentId && card.userId === focusStudentId;
                  const linkItems = cs ? classroomAttachmentLinkItems(cs.attachments) : [];
                  const hasAttachments =
                    Boolean(cs) && Array.isArray(cs.attachments) && cs.attachments.length > 0;
                  const openClassroomHref =
                    cs && !hasAttachments && isSafeHttpUrl(cs.alternateLink)
                      ? cs.alternateLink
                      : null;
                  {/* adjuntos Classroom + fallback alternateLink (http/https) */}

                  if (!row) {
                    const lateOnly = Boolean(cs?.late);
                    return (
                      <li
                        key={card.key}
                        className="pbc-list-item pbc-activity-submission"
                      >
                        <div className="pbc-activity-submission__head">
                          <div className="pbc-list-item__text">
                            <span className="pbc-list-item__title">{identity}</span>
                            <span className="pbc-list-item__meta">
                              {classroomSubmissionStateLabel(cs.state)}
                              {lateOnly ? ` · ${t("pcLate")}` : ""}
                              {cs?.updateTime ? ` · ${fmtTs(cs.updateTime)}` : ""}
                              {cs?.assignedGrade != null ? ` · ${t("pcGradePrefix")} ${cs.assignedGrade}` : ""}
                            </span>
                            <span className="pbc-activity-source-badges" aria-label={t("pcSourcesAria")}>
                              <span className="pbc-activity-source-badge">{"Classroom"}</span>
                            </span>
                          </div>
                        </div>
                        {linkItems.length > 0 ? (
                          <ul className="pbc-activity-attachment-list">
                            {linkItems.map((item) => (
                              <li key={`${item.kind}:${item.href}`}>
                                <a
                                  className="auth-link pbc-activity-evidence-link"
                                  href={item.href}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {item.kind === "driveFile" ? t("pcSubmittedFile") : item.title}
                                  {item.kind === "driveFile" && item.title && item.title !== item.href
                                    ? ` · ${item.title}`
                                    : ""}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {openClassroomHref ? (
                          <p className="pbc-activity-classroom-open">
                            <a
                              className="auth-link pbc-activity-evidence-link"
                              href={openClassroomHref}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("pcOpenSubmissionInClassroom")}
                            </a>
                          </p>
                        ) : null}
                      </li>
                    );
                  }

                  const draft = gradeDraft[row.id] || {
                    grade: row.grade ?? "",
                    feedback: row.feedback ?? "",
                  };
                  const history = (teacherHistoryByUser.get(row.user_id) || []).filter(
                    (h) => h.id !== row.id,
                  );
                  const verLabel = submissionVersionLabel(row.version);
                  const showingCurrent = viewCode === row.id;
                  const process = deriveProcessStatus({
                    status: row.status,
                    version: row.version,
                    hasSubmission: true,
                  });
                  const latePybot =
                    deriveTimeliness({
                      submittedAt: row.submitted_at,
                      dueAt: activity?.due_at,
                    }) === "tarde";
                  const late = latePybot || Boolean(cs?.late);
                  const rd = rubricDraftBySubmission[row.id] || {};
                  const canReview = row.status === "submitted" || row.status === "returned";
                  const canEvaluate =
                    row.status === "submitted" ||
                    row.status === "returned" ||
                    row.status === "graded";
                  const canClose = row.status === "graded";
                  const activityWindowClosed =
                    deriveSubmissionWindow({
                      closeAt: activity?.submission_close_at,
                    }) === "cerrada";
                  const canReopen =
                    row.status === "closed" ||
                    row.status === "graded" ||
                    activityWindowClosed;
                  const gradeDisplay =
                    row.grade != null
                      ? row.grade
                      : cs?.assignedGrade != null
                        ? cs.assignedGrade
                        : null;
                  return (
                    <li
                      key={card.key}
                      ref={isFocused ? focusRowRef : undefined}
                      className={`pbc-list-item pbc-activity-submission${isFocused ? " pbc-activity-submission--focus" : ""}`}
                      id={card.userId ? `entrega-${card.userId}` : undefined}
                    >
                      <div className="pbc-activity-submission__head">
                        <div className="pbc-list-item__text">
                          <span className="pbc-list-item__title">{identity}</span>
                          <span className="pbc-list-item__meta">
                            {verLabel ? `${verLabel} · ` : ""}
                            {processStatusLabel(process)}
                            {late ? ` · ${t("pcLate")}` : ""}
                            {row.submitted_at
                              ? ` · ${fmtTs(row.submitted_at)}`
                              : cs?.updateTime
                                ? ` · ${fmtTs(cs.updateTime)}`
                                : ""}
                            {gradeDisplay != null ? ` · ${t("pcGradePrefix")} ${gradeDisplay}` : ""}
                            {row.classroom_grade_synced_at
                              ? ` · ${t("pcGradeInClassroom")} ${fmtTs(row.classroom_grade_synced_at)}`
                              : ""}
                            {row.classroom_grade_sync_error
                              ? ` · ${t("pcSyncPendingPrefix")}: ${row.classroom_grade_sync_error}`
                              : ""}
                          </span>
                          <span className="pbc-activity-source-badges" aria-label={t("pcSourcesAria")}>
                            <span className="pbc-activity-source-badge">{"PyBot"}</span>
                            {cs ? (
                              <span className="pbc-activity-source-badge">{"Classroom"}</span>
                            ) : null}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="auth-btn auth-btn--ghost auth-btn--sm"
                          onClick={() => {
                            setViewHistoryId(null);
                            setViewCode(showingCurrent ? null : row.id);
                          }}
                        >
                          {showingCurrent ? t("pcHideCode") : t("pcShowCode")}
                        </button>
                      </div>
                      {showingCurrent ? (
                        <SubmissionCodeViewer
                          code={row.submitted_code}
                          ariaLabel={t("pcCodeOfStudentAria").replace("{ver}", verLabel || t("pcCurrentVersion")).replace("{name}", profile?.display_name || t("pcStudent"))}
                        />
                      ) : null}
                      {linkItems.length > 0 ? (
                        <ul className="pbc-activity-attachment-list">
                          {linkItems.map((item) => (
                            <li key={`${item.kind}:${item.href}`}>
                              <a
                                className="auth-link pbc-activity-evidence-link"
                                href={item.href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {item.kind === "driveFile" ? t("pcSubmittedFile") : item.title}
                                {item.kind === "driveFile" && item.title && item.title !== item.href
                                  ? ` · ${item.title}`
                                  : ""}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {openClassroomHref ? (
                        <p className="pbc-activity-classroom-open">
                          <a
                            className="auth-link pbc-activity-evidence-link"
                            href={openClassroomHref}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("pcOpenSubmissionInClassroom")}
                          </a>
                        </p>
                      ) : null}
                      {history.length > 0 ? (
                        <details className="pbc-activity-history">
                          <summary className="auth-card__muted">
                            {t("pcHistorySummary")
                              .replace("{n}", String(history.length))
                              .replace(
                                "{unit}",
                                history.length === 1
                                  ? t("pcHistoryPrevVersion")
                                  : t("pcHistoryPrevVersions"),
                              )}
                          </summary>
                          <ul className="pbc-activity-history__list">
                            {history.map((h) => {
                              const hLabel = submissionVersionLabel(h.version) || "V?";
                              const showingHist = viewHistoryId === h.id;
                              return (
                                <li key={h.id} className="pbc-activity-history__item">
                                  <div className="pbc-activity-submission__head">
                                    <span className="auth-card__muted">
                                      {hLabel}
                                      {" · "}
                                      {submissionStatusLabel(h.status, { version: h.version })}
                                      {h.submitted_at ? ` · ${fmtTs(h.submitted_at)}` : ""}
                                      {h.grade != null ? ` · ${t("pcGradePrefix")} ${h.grade}` : ""}
                                    </span>
                                    <button
                                      type="button"
                                      className="auth-btn auth-btn--ghost auth-btn--sm"
                                      onClick={() => setViewHistoryId(showingHist ? null : h.id)}
                                    >
                                      {showingHist ? t("pcHide") : t("pcShowCode")}
                                    </button>
                                  </div>
                                  {showingHist ? (
                                    <SubmissionCodeViewer
                                      code={h.submitted_code}
                                      height={220}
                                      ariaLabel={t("pcCodeHistoryAria").replace("{ver}", hLabel)}
                                    />
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      ) : null}
                      {rubricCriteria.length > 0 ? (
                        <div className="pbc-activity-rubric-block">
                          <ActivityRubricGradeMatrix
                            criteria={rubricCriteria}
                            scoringMode={activityRubricMeta?.scoring_mode || "points"}
                            schemaGeneration={activityRubricMeta?.schema_generation ?? 2}
                            draft={rd}
                            onChange={(next) =>
                              setRubricDraftBySubmission((prev) => ({
                                ...prev,
                                [row.id]: next,
                              }))
                            }
                            disabled={busy}
                          />
                          <div className="pbc-activity-actions pbc-activity-actions--wrap">
                            <button
                              type="button"
                              className="auth-btn auth-btn--ghost auth-btn--sm"
                              disabled={busy}
                              onClick={() => void onSaveRubricDraft(row.id)}
                            >
                              {t("pcSaveDraft")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="pbc-activity-grade-row">
                        {rubricCriteria.length === 0 ? (
                          <input
                            className="auth-org-input pbc-activity-grade-input"
                            placeholder={
                              activity?.max_points != null
                                ? t("pcGradeOverMax").replace("{n}", String(activity.max_points))
                                : t("pcGradePrefix")
                            }
                            value={draft.grade}
                            onChange={(e) =>
                              setGradeDraft((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, grade: e.target.value },
                              }))
                            }
                          />
                        ) : activityRubricMeta?.scoring_mode === "qualitative" ? (
                          <span className="auth-card__muted pbc-activity-grade-hint">
                            {t("pcQualitativeDash")}
                          </span>
                        ) : (
                          <span className="auth-card__muted pbc-activity-grade-hint">
                            {t("pcGradeEqualsServerTotal")}
                          </span>
                        )}
                        <input
                          className="auth-org-input pbc-activity-feedback-input"
                          placeholder={t("pcFeedbackGeneral")}
                          value={draft.feedback}
                          onChange={(e) =>
                            setGradeDraft((prev) => ({
                              ...prev,
                              [row.id]: { ...draft, feedback: e.target.value },
                            }))
                          }
                        />
                        {canReview ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onRequestReview(row.id)}
                          >
                            {t("pcRequestReview")}
                          </button>
                        ) : null}
                        {canEvaluate ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--primary auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onGrade(row.id)}
                          >
                            {t("pcEvaluate")}
                          </button>
                        ) : null}
                        {canClose ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onCloseSubmission(row.id)}
                          >
                            {t("pcClose")}
                          </button>
                        ) : null}
                        {canReopen ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onReopen(row.user_id)}
                          >
                            {t("pcReopenForStudent")}
                          </button>
                        ) : null}
                        {activity?.classroom_coursework_id && row.grade != null ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onSendGradeClassroom(row)}
                          >
                            {row.classroom_grade_sync_error
                              ? t("pcRetryClassroomSync")
                              : t("pcSendGradeToClassroom")}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </PbcSection>
        ) : null}

        {canTeach && itemTeacherRows.length > 0 ? (
          <PbcSection
            title={t("pcEmbeddedItemSubmissions")}
            description={t("pcEmbeddedItemSubmissionsDesc")}
          >
            <ul className="pbc-list pbc-activity-submissions">
              {itemTeacherRows.map((row) => {
                const profile = profilesById.get(row.user_id);
                const itemMeta = snapshotItems.find((i) => i.snapshotItemId === row.snapshot_item_id);
                const draft = itemGradeDraft[row.id] || {
                  earned: row.earned_points ?? "",
                  possible: row.possible_points ?? "",
                  feedback: row.feedback ?? "",
                };
                const verLabel = itemSubmissionVersionLabel(row.version);
                return (
                  <li key={row.id} className="pbc-list-item pbc-activity-submission">
                    <div className="pbc-list-item__text">
                      <span className="pbc-list-item__title">
                        {profile?.display_name || profile?.email || row.user_id.slice(0, 8)}
                        {" · "}
                        {itemMeta?.title || row.snapshot_item_id}
                      </span>
                      <span className="pbc-list-item__meta">
                        {itemMeta?.type || row.item_type}
                        {verLabel ? ` · ${verLabel}` : ""}
                        {row.submitted_at ? ` · ${fmtTs(row.submitted_at)}` : ""}
                        {row.status === "graded" && row.earned_points != null
                          ? ` · ${row.earned_points}/${row.possible_points}`
                          : ` · ${row.status}`}
                      </span>
                      {row.response_text ? (
                        <p className="auth-card__muted" style={{ margin: "0.35rem 0 0", whiteSpace: "pre-wrap" }}>
                          {row.response_text}
                        </p>
                      ) : null}
                    </div>
                    <div className="pbc-activity-grade-row" style={{ marginTop: "0.5rem" }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="auth-org-input pbc-activity-grade-input"
                        placeholder={t("pcEarnedPoints")}
                        value={draft.earned}
                        onChange={(e) =>
                          setItemGradeDraft((prev) => ({
                            ...prev,
                            [row.id]: { ...draft, earned: e.target.value },
                          }))
                        }
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="auth-org-input pbc-activity-grade-input"
                        placeholder={t("pcPossiblePoints")}
                        value={draft.possible}
                        onChange={(e) => {
                          const v = e.target.value;
                          // UI: do not accept 0 for Posibles (backend remains definitive).
                          if (v !== "" && Number(v) === 0) return;
                          setItemGradeDraft((prev) => ({
                            ...prev,
                            [row.id]: { ...draft, possible: v },
                          }));
                        }}
                      />
                      <input
                        className="auth-org-input"
                        placeholder={t("pcFeedbackOptional")}
                        value={draft.feedback}
                        onChange={(e) =>
                          setItemGradeDraft((prev) => ({
                            ...prev,
                            [row.id]: { ...draft, feedback: e.target.value },
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="auth-btn auth-btn--primary auth-btn--sm"
                        disabled={busy}
                        onClick={() => void onGradeItemSubmission(row.id)}
                      >
                        {t("pcGradeItem")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </PbcSection>
        ) : null}

        <div className="pbc-footer-links">
          {canTeach ? (
            activity?.course_id ? (
              <Link to={entregasHref} className="auth-link">
                {t("pcViewCourseSubmissions")}
              </Link>
            ) : null
          ) : (
            <Link to={courseHref} className="auth-link">
              {t("pcBackToCourseArrow")}
            </Link>
          )}
        </div>
      </PbcPage>
    </PyBotClassShell>
  );
}
