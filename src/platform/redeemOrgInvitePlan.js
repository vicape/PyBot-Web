/**
 * Plan puro que refleja el comportamiento de redeem_org_invite (migración 015).
 * Usado por tests y por la UI de join para mensajes / destino.
 */

/**
 * @param {{
 *   invite: {
 *     org_id: string,
 *     course_id: string | null,
 *     role: string,
 *     expires_at: string | null,
 *     use_count: number,
 *     max_uses: number,
 *   } | null,
 *   courseOrgId: string | null,
 *   isOrgMember: boolean,
 *   isCourseMember: boolean,
 *   now?: Date,
 * }} input
 */
export function planRedeemOrgInvite({
  invite,
  courseOrgId,
  isOrgMember,
  isCourseMember,
  now = new Date(),
}) {
  if (!invite) {
    return { ok: false, error: "not_found" };
  }

  if (invite.expires_at != null && new Date(invite.expires_at) < now) {
    return { ok: false, error: "expired" };
  }

  if (invite.use_count >= invite.max_uses) {
    return { ok: false, error: "max_uses" };
  }

  if (invite.course_id) {
    if (!courseOrgId || courseOrgId !== invite.org_id) {
      return { ok: false, error: "curso_invalido" };
    }

    const actions = [];
    if (!isOrgMember) {
      actions.push({ type: "insert_organization_member", org_id: invite.org_id, role: invite.role });
    }
    actions.push({
      type: "upsert_course_member",
      course_id: invite.course_id,
      role: invite.role === "teacher" ? "teacher" : "student",
      source: "invite",
      already: isCourseMember,
    });
    actions.push({ type: "increment_use_count" });

    return {
      ok: true,
      org_id: invite.org_id,
      course_id: invite.course_id,
      role: invite.role,
      actions,
    };
  }

  if (isOrgMember) {
    return { ok: false, error: "already_member" };
  }

  return {
    ok: true,
    org_id: invite.org_id,
    course_id: null,
    role: invite.role,
    actions: [
      { type: "insert_organization_member", org_id: invite.org_id, role: invite.role },
      { type: "increment_use_count" },
    ],
  };
}

/** Destino post-redeem según respuesta de la RPC. */
export function joinPathAfterRedeem(out) {
  if (!out?.org_id) return "/dashboard";
  if (out.course_id) {
    return `/dashboard/org/${out.org_id}/course/${out.course_id}`;
  }
  return `/dashboard/org/${out.org_id}`;
}

/** Mensaje de éxito según tipo de invitación. */
export function joinSuccessMessage(out, roleLabel) {
  if (out?.course_id) return "Listo: te uniste al curso.";
  return `Listo: te uniste como ${roleLabel(out?.role)}.`;
}
