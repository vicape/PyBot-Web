import { getSupabase } from "../supabaseClient.js";
import { slugifyOrganizationName } from "../slugify.js";
import { updateCourseActivity } from "./courseActivityApi.js";

const LIMIT = 500;

function sb() {
  const client = getSupabase();
  if (!client) return { client: null, error: "no_client" };
  return { client, error: null };
}

export async function fetchAdminUsageSessions() {
  const { client, error } = sb();
  if (error) return { rows: [], error };

  const { data, error: e } = await client
    .from("usage_sessions")
    .select(
      "id, started_at, last_seen_at, ended_at, duration_seconds, is_authenticated, ip, ip_prefix, country, city, browser, os, landing_path, user_id",
    )
    .order("started_at", { ascending: false })
    .limit(LIMIT);

  return { rows: data ?? [], error: e?.message ?? null };
}

export async function deleteAdminUsageSession(sessionId) {
  const { client, error } = sb();
  if (error) return { ok: false, error };
  const { data, error: e } = await client.rpc("admin_delete_usage_session", {
    p_session_id: sessionId,
  });
  if (e) return { ok: false, error: e.message };
  if (!data?.ok) return { ok: false, error: data?.error || "delete_failed" };
  return { ok: true, error: null };
}

export async function deleteAdminUserTelemetry(userId) {
  const { client, error } = sb();
  if (error) return { ok: false, error };
  const { data, error: e } = await client.rpc("admin_delete_user_telemetry", {
    p_user_id: userId,
  });
  if (e) return { ok: false, error: e.message };
  if (!data?.ok) return { ok: false, error: data?.error || "delete_failed" };
  return { ok: true, deleted: data.deleted ?? 0, error: null };
}

export async function fetchAdminProfiles() {
  const { client, error } = sb();
  if (error) return { rows: [], error };

  const { data, error: e } = await client
    .from("profiles")
    .select("id, email, display_name, preferred_role, is_super_admin, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return { rows: data ?? [], error: e?.message ?? null };
}

export async function updateAdminProfile(id, patch) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  const body = {};
  if (patch.display_name != null) body.display_name = String(patch.display_name).trim();
  if (patch.preferred_role === "teacher" || patch.preferred_role === "student") {
    body.preferred_role = patch.preferred_role;
  }
  if (typeof patch.is_super_admin === "boolean") body.is_super_admin = patch.is_super_admin;

  const { error: e } = await client.from("profiles").update(body).eq("id", id);
  return { ok: !e, error: e?.message ?? null };
}

export async function fetchAdminOrganizations() {
  const { client, error } = sb();
  if (error) return { rows: [], error };

  const { data, error: e } = await client
    .from("organizations")
    .select("id, name, slug, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return { rows: data ?? [], error: e?.message ?? null };
}

export async function createAdminOrganization({ name, slug, createdBy }) {
  const { client, error } = sb();
  if (error) return { row: null, error };
  const n = String(name ?? "").trim();
  if (!n) return { row: null, error: "Nombre requerido" };

  let s = String(slug ?? "").trim() || slugifyOrganizationName(n);
  for (let i = 0; i < 8; i++) {
    const { data, error: e } = await client
      .from("organizations")
      .insert({ name: n, slug: s, created_by: createdBy })
      .select("id, name, slug, created_at")
      .maybeSingle();
    if (!e && data) return { row: data, error: null };
    if (e?.code === "23505") {
      s = `${slugifyOrganizationName(n)}-${Math.random().toString(36).slice(2, 7)}`;
      continue;
    }
    return { row: null, error: e?.message ?? "Error al crear colegio" };
  }
  return { row: null, error: "No hay slug disponible" };
}

export async function updateAdminOrganization(id, patch) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  const body = {};
  if (patch.name != null) body.name = String(patch.name).trim();
  if (patch.slug != null) body.slug = String(patch.slug).trim();

  const { error: e } = await client.from("organizations").update(body).eq("id", id);
  return { ok: !e, error: e?.message ?? null };
}

export async function deleteAdminOrganization(id) {
  const { client, error } = sb();
  if (error) return { ok: false, error };
  const { error: e } = await client.from("organizations").delete().eq("id", id);
  return { ok: !e, error: e?.message ?? null };
}

export async function fetchAdminCourses() {
  const { client, error } = sb();
  if (error) return { rows: [], error };

  const { data, error: e } = await client
    .from("courses")
    .select("id, org_id, title, slug, classroom_course_id, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return { rows: data ?? [], error: e?.message ?? null };
}

export async function createAdminCourse({ orgId, title, slug, createdBy }) {
  const { client, error } = sb();
  if (error) return { row: null, error };
  const t = String(title ?? "").trim();
  if (!orgId || !t) return { row: null, error: "Colegio y título requeridos" };

  const payload = { org_id: orgId, title: t, created_by: createdBy };
  if (slug?.trim()) payload.slug = slug.trim();

  const { data, error: e } = await client
    .from("courses")
    .insert(payload)
    .select("id, org_id, title, slug, created_at")
    .maybeSingle();

  return { row: data, error: e?.message ?? null };
}

export async function updateAdminCourse(id, patch) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  const body = {};
  if (patch.title != null) body.title = String(patch.title).trim();
  if (patch.slug != null) body.slug = String(patch.slug).trim() || null;
  if (patch.org_id) body.org_id = patch.org_id;

  const { error: e } = await client.from("courses").update(body).eq("id", id);
  return { ok: !e, error: e?.message ?? null };
}

export async function deleteAdminCourse(id) {
  const { client, error } = sb();
  if (error) return { ok: false, error };
  const { error: e } = await client.from("courses").delete().eq("id", id);
  return { ok: !e, error: e?.message ?? null };
}

export async function fetchAdminActivities() {
  const { client, error } = sb();
  if (error) return { rows: [], error };

  const { data, error: e } = await client
    .from("activities")
    .select("id, course_id, title, description, starter_code, pybot_lesson_id, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return { rows: data ?? [], error: e?.message ?? null };
}

export async function createAdminActivity({
  courseId,
  title,
  starterCode,
  description,
  pybotLessonId,
  createdBy,
}) {
  const { client, error } = sb();
  if (error) return { row: null, error };
  const t = String(title ?? "").trim();
  if (!courseId || !t) return { row: null, error: "Curso y título requeridos" };

  const { data, error: e } = await client
    .from("activities")
    .insert({
      course_id: courseId,
      title: t,
      starter_code: starterCode ?? "",
      description: description ?? "",
      pybot_lesson_id: pybotLessonId?.trim() || null,
      created_by: createdBy,
    })
    .select("id, course_id, title, description, starter_code, pybot_lesson_id, created_at")
    .maybeSingle();

  return { row: data, error: e?.message ?? null };
}

export async function updateAdminActivity(id, patch) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  return updateCourseActivity(client, id, {
    title: patch.title,
    description: patch.description,
    pybotLessonId: patch.pybot_lesson_id,
    starterCode: patch.starter_code,
    courseId: patch.course_id,
  });
}

export async function deleteAdminActivity(id) {
  const { client, error } = sb();
  if (error) return { ok: false, error };
  const { error: e } = await client.from("activities").delete().eq("id", id);
  return { ok: !e, error: e?.message ?? null };
}

export async function fetchAdminOrgMembers() {
  const { client, error } = sb();
  if (error) return { rows: [], error };

  const { data, error: e } = await client
    .from("organization_members")
    .select("org_id, user_id, role, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return { rows: data ?? [], error: e?.message ?? null };
}

export async function findProfileIdByEmail(email) {
  const { client, error } = sb();
  if (error) return { userId: null, error };

  const { data, error: e } = await client.rpc("find_profile_by_email", {
    p_email: String(email ?? "").trim().toLowerCase(),
  });
  if (e) return { userId: null, error: e.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { userId: row?.id ?? null, error: row?.id ? null : "Usuario no encontrado (debe haber entrado al menos una vez)" };
}

export async function createAdminOrgMember({ orgId, userId, role }) {
  const { client, error } = sb();
  if (error) return { ok: false, error };
  if (!orgId || !userId || !role) return { ok: false, error: "Datos incompletos" };

  const { error: e } = await client
    .from("organization_members")
    .upsert({ org_id: orgId, user_id: userId, role }, { onConflict: "org_id,user_id" });

  return { ok: !e, error: e?.message ?? null };
}

export async function updateAdminOrgMember({ orgId, userId, role }) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  const { error: e } = await client
    .from("organization_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId);

  return { ok: !e, error: e?.message ?? null };
}

export async function deleteAdminOrgMember({ orgId, userId }) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  const { error: e } = await client
    .from("organization_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId);

  return { ok: !e, error: e?.message ?? null };
}

export async function fetchAdminCourseMembers() {
  const { client, error } = sb();
  if (error) return { rows: [], error };

  const { data, error: e } = await client
    .from("course_members")
    .select("course_id, user_id, role, source, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return { rows: data ?? [], error: e?.message ?? null };
}

export async function createAdminCourseMember({ courseId, userId, role }) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  const { error: e } = await client.from("course_members").upsert(
    { course_id: courseId, user_id: userId, role, source: "manual" },
    { onConflict: "course_id,user_id" },
  );

  return { ok: !e, error: e?.message ?? null };
}

export async function deleteAdminCourseMember({ courseId, userId }) {
  const { client, error } = sb();
  if (error) return { ok: false, error };

  const { error: e } = await client
    .from("course_members")
    .delete()
    .eq("course_id", courseId)
    .eq("user_id", userId);

  return { ok: !e, error: e?.message ?? null };
}
