import { getSupabase } from "../supabaseClient.js";
import { slugifyOrganizationName } from "../slugify.js";

export async function createOrganizationWithOwner({ name, countryCode, slug }) {
  const sb = getSupabase();
  if (!sb) return { orgId: null, error: "no_supabase" };

  const trimmedName = String(name ?? "").trim();
  const cc = String(countryCode ?? "").trim().toUpperCase();
  const baseSlug = slug || slugifyOrganizationName(trimmedName);

  if (!trimmedName) return { orgId: null, error: "El nombre es obligatorio." };
  if (!cc || cc.length !== 2) return { orgId: null, error: "Seleccioná un país." };

  const v2 = await sb.rpc("create_organization_with_owner_v2", {
    p_name: trimmedName,
    p_slug: baseSlug,
    p_country_code: cc,
  });

  if (!v2.error && v2.data?.ok) {
    return { orgId: v2.data.org_id, slug: v2.data.slug, error: null };
  }

  const v2Missing =
    v2.error?.message?.includes("does not exist") ||
    v2.error?.message?.includes("function") ||
    v2.error?.code === "42883" ||
    v2.error?.code === "PGRST202";

  if (!v2Missing && v2.error) {
    if (v2.data?.error === "slug_taken") return { orgId: null, error: "Ese nombre ya existe." };
    return { orgId: null, error: v2.error.message || "No se pudo crear la institución." };
  }

  const v1 = await sb.rpc("create_organization_with_owner", {
    p_name: trimmedName,
    p_slug: baseSlug,
  });

  if (!v1.error && v1.data?.org_id) {
    if (cc) {
      await sb.from("organizations").update({ country_code: cc }).eq("id", v1.data.org_id);
    }
    return { orgId: v1.data.org_id, slug: v1.data.slug, error: null };
  }

  return { orgId: null, error: v1.error?.message || "No se pudo crear la institución." };
}

export async function ensureOrgTeacherAccess(orgId) {
  const sb = getSupabase();
  if (!sb || !orgId) return { ok: false, error: "missing_args" };

  const rpc = await sb.rpc("ensure_org_teacher_access", { p_org_id: orgId });
  if (!rpc.error && rpc.data?.ok) return { ok: true, error: null };

  const rpcMissing =
    rpc.error?.message?.includes("does not exist") ||
    rpc.error?.code === "42883" ||
    rpc.error?.code === "PGRST202";

  if (rpcMissing) {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return { ok: false, error: "no_session" };

    const { data: existing } = await sb
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing?.role === "owner" || existing?.role === "teacher") {
      return { ok: true, error: null };
    }

    const { error } = await sb.from("organization_members").upsert(
      { org_id: orgId, user_id: userId, role: "teacher" },
      { onConflict: "org_id,user_id" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  }

  return { ok: false, error: rpc.error?.message || rpc.data?.error || "forbidden" };
}

export async function fetchOrganizationsForUser(supabase, userId) {
  if (!supabase || !userId) return [];

  const rpc = await supabase.rpc("list_my_org_memberships");
  if (!rpc.error && Array.isArray(rpc.data)) {
    const byOrg = new Map();
    for (const m of rpc.data) {
      if (!m?.org_id) continue;
      const prev = byOrg.get(m.org_id) || {
        id: m.org_id,
        name: m.org_name,
        slug: m.org_slug,
        roles: [],
        country_code: m.country_code ?? null,
      };
      if (m.org_name) prev.name = m.org_name;
      if (m.org_slug) prev.slug = m.org_slug;
      if (m.country_code) prev.country_code = m.country_code;
      if (m.role && !prev.roles.includes(m.role)) prev.roles.push(m.role);
      byOrg.set(m.org_id, prev);
    }
    // Enrich names when RPC only returns org_id/role (legacy shape)
    const rows = [...byOrg.values()];
    const needNames = rows.filter((r) => !r.name);
    if (needNames.length) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, slug, country_code")
        .in(
          "id",
          needNames.map((r) => r.id),
        );
      for (const o of orgs ?? []) {
        const row = byOrg.get(o.id);
        if (!row) continue;
        row.name = o.name;
        row.slug = o.slug;
        row.country_code = o.country_code ?? row.country_code;
      }
    }
    return [...byOrg.values()].map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      role: r.roles.includes("owner")
        ? "owner"
        : r.roles.includes("teacher")
          ? "teacher"
          : r.roles[0] ?? null,
      roles: r.roles,
      country_code: r.country_code ?? null,
    }));
  }

  const { data } = await supabase
    .from("organization_members")
    .select("role, organizations ( id, name, slug, country_code )")
    .eq("user_id", userId);

  const byOrg = new Map();
  for (const row of data ?? []) {
    const id = row.organizations?.id;
    if (!id) continue;
    const prev = byOrg.get(id) || {
      id,
      name: row.organizations?.name,
      slug: row.organizations?.slug,
      roles: [],
      country_code: row.organizations?.country_code ?? null,
    };
    if (row.role && !prev.roles.includes(row.role)) prev.roles.push(row.role);
    byOrg.set(id, prev);
  }
  return [...byOrg.values()].map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    role: r.roles.includes("owner")
      ? "owner"
      : r.roles.includes("teacher")
        ? "teacher"
        : r.roles[0] ?? null,
    roles: r.roles,
    country_code: r.country_code ?? null,
  }));
}
