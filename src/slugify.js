/** Slug estable para URLs; minúsculas, guiones. */
export function slugifyOrganizationName(name) {
  const raw = String(name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return raw.length > 0 ? raw : "colegio";
}
