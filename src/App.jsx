import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import PyBotIDE from "./PyBotIDE.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AuthCallbackPage from "./pages/AuthCallbackPage.jsx";
import OrgCoursesPage from "./pages/OrgCoursesPage.jsx";
import CourseActivitiesPage from "./pages/CourseActivitiesPage.jsx";
import JoinOrgPage from "./pages/JoinOrgPage.jsx";
import ActivityPage from "./pages/ActivityPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import PyBotClassPage from "./pages/PyBotClassPage.jsx";
import PyBotClassCoursePage from "./pages/PyBotClassCoursePage.jsx";
import MyContentPage from "./pages/MyContentPage.jsx";
import ContentEditorPage from "./pages/ContentEditorPage.jsx";
import LessonEditorPage from "./pages/LessonEditorPage.jsx";
import CommunityPage from "./pages/CommunityPage.jsx";
import SharedContentPage from "./pages/SharedContentPage.jsx";
import TelemetryBootstrap from "./components/TelemetryBootstrap.jsx";
import { isSupabaseConfigured } from "./supabaseClient.js";

function AppRoutes() {
  return (
    <BrowserRouter>
      <TelemetryBootstrap />
      <Routes>
        <Route path="/" element={<PyBotIDE />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/join" element={<JoinOrgPage />} />
        <Route path="/actividad/:activityId" element={<ActivityPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/admin" element={<AdminPage />} />
        <Route path="/dashboard/classes" element={<PyBotClassPage />} />
        <Route path="/dashboard/classes/:courseId" element={<PyBotClassCoursePage />} />
        <Route path="/dashboard/content" element={<MyContentPage />} />
        <Route path="/dashboard/content/:contentId" element={<ContentEditorPage />} />
        <Route path="/dashboard/content/:contentId/lessons/:lessonId" element={<LessonEditorPage />} />
        <Route path="/dashboard/community" element={<CommunityPage />} />
        <Route path="/dashboard/community/:contentId" element={<SharedContentPage />} />
        <Route path="/dashboard/org/:orgId" element={<OrgCoursesPage />} />
        <Route
          path="/dashboard/org/:orgId/course/:courseId"
          element={<CourseActivitiesPage />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  const supabaseReady = isSupabaseConfigured();
  const rawClient =
    typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string"
      ? import.meta.env.VITE_GOOGLE_CLIENT_ID.trim()
      : "";
  const googleClientReady = rawClient.length > 0;

  if (!supabaseReady && googleClientReady) {
    return (
      <GoogleOAuthProvider clientId={rawClient}>
        <AppRoutes />
      </GoogleOAuthProvider>
    );
  }

  return <AppRoutes />;
}
