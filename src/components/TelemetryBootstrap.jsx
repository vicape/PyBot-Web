import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { initializeTelemetry, trackPageView } from "../telemetry/index.js";

/** Arranca telemetría una vez y registra page_view en cambios de ruta. */
export default function TelemetryBootstrap() {
  const location = useLocation();
  const started = useRef(false);
  const lastPath = useRef("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void initializeTelemetry();
  }, []);

  useEffect(() => {
    const path = `${location.pathname}${location.search || ""}`;
    if (path === lastPath.current) return;
    lastPath.current = path;
    // skip first paint (app_open ya envía page_view)
    if (!started.current) return;
    trackPageView(location.pathname);
  }, [location.pathname, location.search]);

  return null;
}
