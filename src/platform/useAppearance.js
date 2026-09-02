import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyAppearanceToElement,
  fetchAppearance,
  resolveTheme,
  saveAppearance,
} from "./appearanceApi.js";

export function useAppearance(userId, containerRef) {
  const [appearance, setAppearance] = useState({ theme: "system", background: "default", customColor: "#1e3a5f" });
  const [resolvedTheme, setResolvedTheme] = useState("dark");
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const apply = useCallback(
    (next) => {
      setAppearance(next);
      const resolved = resolveTheme(next.theme);
      setResolvedTheme(resolved);
      if (containerRef?.current) {
        applyAppearanceToElement(containerRef.current, next);
      }
    },
    [containerRef],
  );

  useEffect(() => {
    mounted.current = true;
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    (async () => {
      const { appearance: loaded } = await fetchAppearance(userId);
      if (!mounted.current) return;
      apply(loaded);
      setLoading(false);
    })();

    return () => {
      mounted.current = false;
    };
  }, [userId, apply]);

  useEffect(() => {
    if (appearance.theme !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setResolvedTheme(resolveTheme("system"));
      if (containerRef?.current) {
        applyAppearanceToElement(containerRef.current, appearance);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance, containerRef]);

  const updateAppearance = useCallback(
    async (partial) => {
      const next = { ...appearance, ...partial };
      apply(next);
      await saveAppearance(userId, next);
      return next;
    },
    [appearance, apply, userId],
  );

  return { appearance, resolvedTheme, loading, updateAppearance, apply };
}
