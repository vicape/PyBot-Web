/** Rol de plataforma (independiente de owner/teacher/student en colegios). */

export function isSuperAdmin(profile) {
  return profile?.is_super_admin === true;
}
