import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import PyBotIDE from "./PyBotIDE.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AuthCallbackPage from "./pages/AuthCallbackPage.jsx";
import { isSupabaseConfigured } from "./supabaseClient.js";

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PyBotIDE />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
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
