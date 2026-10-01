/**
 * React hook: wires Point 5 engagement manager to a student activity surface.
 * Presence-only listeners (no event payload capture/serialization).
 * Returned API object is referentially stable across rerenders (same activity context).
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ENGAGEMENT_SYNC_INTERVAL_MS,
  createEngagementManager,
  resolveAssignedIdeEngagementTarget,
  resolveLessonDocumentEngagementTarget,
  resolveSnapshotItemEngagementTarget,
} from "./activityEngagement.js";
import {
  discardLegacyUnscopedPendingEngagement,
  flushPendingEngagementSegments,
  handleEngagementFlush,
} from "./activityEngagementSync.js";
import { getSupabase } from "../supabaseClient.js";

/**
 * @param {{
 *   enabled?: boolean,
 *   activityId?: string | null,
 *   mode?: "content" | "ide",
 *   activity?: object | null,
 *   snapshot?: object | null,
 * }} opts
 */
export function useActivityEngagement({
  enabled = false,
  activityId = null,
  mode = "content",
  activity = null,
  snapshot = null,
} = {}) {
  const managerRef = useRef(null);
  const surfaceRef = useRef(null);
  const surfaceCleanupRef = useRef(null);
  const tickTimerRef = useRef(null);
  const activityRef = useRef(activity);
  const snapshotRef = useRef(snapshot);
  /** Local pending-queue namespace only — never trusted write identity. */
  const localUserIdRef = useRef(null);
  activityRef.current = activity;
  snapshotRef.current = snapshot;

  useEffect(() => {
    const sb = getSupabase();
    if (!sb?.auth) return undefined;
    let cancelled = false;
    void sb.auth.getSession().then(({ data }) => {
      if (!cancelled) localUserIdRef.current = data?.session?.user?.id || null;
    });
    const { data: sub } = sb.auth.onAuthStateChange((_evt, session) => {
      localUserIdRef.current = session?.user?.id || null;
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const ensureManager = useCallback(() => {
    if (!enabled || !activityId) return null;
    if (managerRef.current && managerRef.current.getSnapshot().activityId === String(activityId)) {
      return managerRef.current;
    }
    if (managerRef.current) {
      managerRef.current.destroy();
      managerRef.current = null;
    }
    const mgr = createEngagementManager({
      activityId,
      onFlush: (payload) => {
        void handleEngagementFlush(
          payload,
          getSupabase(),
          undefined,
          localUserIdRef.current,
        );
      },
    });
    managerRef.current = mgr;
    return mgr;
  }, [enabled, activityId]);

  useEffect(() => {
    if (!enabled || !activityId) {
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
      }
      return undefined;
    }

    const mgr = ensureManager();
    if (!mgr) return undefined;

    discardLegacyUnscopedPendingEngagement();
    void flushPendingEngagementSegments(getSupabase(), undefined, localUserIdRef.current);

    const onVisibility = () => {
      mgr.setDocumentVisible(
        typeof document === "undefined" ? true : document.visibilityState === "visible",
      );
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    const onPageHide = () => {
      mgr.flush("pagehide");
      mgr.setDocumentVisible(false);
    };
    window.addEventListener("pagehide", onPageHide);

    tickTimerRef.current = setInterval(() => {
      mgr.advanceClock();
    }, Math.min(1000, ENGAGEMENT_SYNC_INTERVAL_MS));

    if (mode === "ide") {
      const target = resolveAssignedIdeEngagementTarget(
        activityId,
        activityRef.current,
        snapshotRef.current,
      );
      if (target) {
        mgr.setTarget(target, { startIfEligible: true });
        mgr.noteInteraction();
      }
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      mgr.destroy();
      if (managerRef.current === mgr) managerRef.current = null;
    };
  }, [enabled, activityId, mode, ensureManager]);

  const attachSurfaceListeners = useCallback(
    (node) => {
      if (surfaceCleanupRef.current) {
        surfaceCleanupRef.current();
        surfaceCleanupRef.current = null;
      }
      surfaceRef.current = node;
      if (!node || !enabled) return;

      const mgr = ensureManager();
      if (!mgr) return;

      // Presence-only: refresh in-memory activity; never serialize event payloads.
      const onPointer = () => mgr.noteInteraction();
      const onKey = () => mgr.noteInteraction();
      const onScroll = () => mgr.noteInteraction();

      node.addEventListener("pointerdown", onPointer, { passive: true });
      node.addEventListener("keydown", onKey, { passive: true });
      node.addEventListener("scroll", onScroll, { passive: true, capture: true });

      surfaceCleanupRef.current = () => {
        node.removeEventListener("pointerdown", onPointer);
        node.removeEventListener("keydown", onKey);
        node.removeEventListener("scroll", onScroll, true);
      };
    },
    [enabled, ensureManager],
  );

  useEffect(() => {
    if (!enabled) {
      if (surfaceCleanupRef.current) {
        surfaceCleanupRef.current();
        surfaceCleanupRef.current = null;
      }
      return undefined;
    }
    if (surfaceRef.current) attachSurfaceListeners(surfaceRef.current);
    return () => {
      if (surfaceCleanupRef.current) {
        surfaceCleanupRef.current();
        surfaceCleanupRef.current = null;
      }
    };
  }, [attachSurfaceListeners, enabled, activityId]);

  const setSurfaceRef = useCallback(
    (node) => {
      attachSurfaceListeners(node);
    },
    [attachSurfaceListeners],
  );

  const setLessonDocument = useCallback(
    (lesson) => {
      const mgr = ensureManager();
      if (!mgr) return;
      const target = resolveLessonDocumentEngagementTarget(lesson);
      if (target) mgr.setLessonDocumentTarget(target);
    },
    [ensureManager],
  );

  const activateLessonDocument = useCallback(() => {
    managerRef.current?.activateLessonDocument?.();
  }, []);

  const setItemTarget = useCallback(
    (item) => {
      const mgr = ensureManager();
      if (!mgr) return;
      const snap = mgr.getSnapshot();
      // Playing video has highest priority and overrides item attribution.
      if (snap.videoPlaying && snap.currentTarget?.targetType === "video") {
        const target = resolveSnapshotItemEngagementTarget(item);
        if (!target || snap.currentTarget.targetId !== target.targetId) return;
      }
      const target = resolveSnapshotItemEngagementTarget(item);
      if (target) {
        mgr.setTarget(target, { startIfEligible: true });
        if (target.targetType !== "video") mgr.noteInteraction();
      }
    },
    [ensureManager],
  );

  const leaveTarget = useCallback(() => {
    managerRef.current?.leaveCurrentTarget();
  }, []);

  const onVideoMediaState = useCallback(
    (item, state) => {
      const mgr = ensureManager();
      if (!mgr || !item) return;
      const target = resolveSnapshotItemEngagementTarget(item);
      if (!target) return;
      const snap = mgr.getSnapshot();
      if (!snap.currentTarget || snap.currentTarget.targetId !== target.targetId) {
        mgr.setTarget(target, { startIfEligible: false });
      }
      mgr.setVideoMediaState(state);
    },
    [ensureManager],
  );

  const noteInteraction = useCallback(() => {
    managerRef.current?.noteInteraction();
  }, []);

  const getSnapshot = useCallback(() => managerRef.current?.getSnapshot() || null, []);

  // Stable API: consumers may put this object in effect deps without fragmenting sessions.
  return useMemo(
    () => ({
      setSurfaceRef,
      setLessonDocument,
      activateLessonDocument,
      setItemTarget,
      leaveTarget,
      onVideoMediaState,
      noteInteraction,
      getSnapshot,
    }),
    [
      setSurfaceRef,
      setLessonDocument,
      activateLessonDocument,
      setItemTarget,
      leaveTarget,
      onVideoMediaState,
      noteInteraction,
      getSnapshot,
    ],
  );
}
