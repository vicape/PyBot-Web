/**
 * Vercel Serverless Function: renueva el access_token de Google Classroom.
 *
 * POST /api/refresh-classroom-token
 * Header: Authorization: Bearer <supabase_access_token>
 * Body:   { refresh_token: string }
 *
 * Responde: { access_token, expires_in } o { error }
 *
 * Variables de entorno necesarias en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL           — igual que VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_KEY   — Service Role Key (Settings → API → service_role)
 *   GOOGLE_CLIENT_ID       — igual que VITE_GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET   — Client Secret de Google Cloud Console
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const supabaseToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const { refresh_token: refreshToken } = req.body || {};

  if (!supabaseToken || !refreshToken) {
    return res.status(400).json({ error: "missing_params" });
  }

  // Validar que el JWT de Supabase sea válido
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${supabaseToken}`,
      apikey: serviceKey,
    },
  });
  if (!userRes.ok) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Renovar el access_token con Google
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "google_not_configured" });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const googleRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await googleRes.json().catch(() => ({}));
  if (!googleRes.ok) {
    return res.status(400).json({ error: data.error || "google_refresh_failed" });
  }

  return res.status(200).json({
    access_token: data.access_token,
    expires_in: data.expires_in ?? 3600,
  });
}
