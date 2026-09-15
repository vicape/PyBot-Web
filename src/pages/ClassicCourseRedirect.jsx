import { Navigate, useParams, useSearchParams } from "react-router-dom";

/**
 * Redirige la Vista clásica de curso (/dashboard/org/.../course/...)
 * a la UX única de PyBotClass (/dashboard/classes/:courseId).
 */
export default function ClassicCourseRedirect() {
  const { courseId } = useParams();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const qs =
    tab === "actividades" || tab === "alumnos" ? `?tab=${encodeURIComponent(tab)}` : "";
  return <Navigate to={`/dashboard/classes/${courseId}${qs}`} replace />;
}
