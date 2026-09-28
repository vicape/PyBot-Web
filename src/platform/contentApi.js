import { getSupabase } from "../supabaseClient.js";
import {
  CONTENT_ITEMS_MIGRATION_HINT,
  CONTENT_ITEM_TYPES,
  CONTENT_V3_MIGRATION_HINT,
  LEARNING_CONTENT_SELECT_BASE,
  LEARNING_CONTENT_SELECT_LEGACY,
  derivePreparationStatus,
  isCanonicalItemType,
  mapLegacyItemType,
  normalizeContentMetadataPatch,
  normalizeItemType,
  normalizeUnitType,
  pickContentMetadata,
} from "./contentMetadata.js";
import {
  CONTENT_MEDIA_BUCKET,
  CONTENT_MEDIA_SCHEME,
  parseContentMediaRef,
  toContentMediaRef,
} from "../components/content-editor/contentMedia.js";

export const BLOCK_TYPES = {
  theory: { label: "Teoría", hasStarterCode: false },
  example: { label: "Ejemplo", hasStarterCode: true },
  exercise: { label: "Ejercicio", hasStarterCode: true },
  task: { label: "Tarea", hasStarterCode: false },
};

export const CONTENT_STATUS_LABELS = {
  draft: "Borrador",
  published: "Publicado",
};

export const CONTENT_VISIBILITY_LABELS = {
  private: "Privado",
  courses: "Mis cursos",
  community: "Comunidad",
};

export {
  CONTENT_DIFFICULTIES,
  CONTENT_LANGUAGE_CODES,
  CONTENT_ITEM_TYPES,
  CONTENT_V3_ITEM_TYPES,
  CONTENT_V3_MIGRATION_HINT,
  CONTENT_ITEMS_MIGRATION_HINT,
  UNIT_TYPES,
  LESSON_ITEM_TYPES,
  LESSON_ITEM_CREATE_TYPES,
  UNIT_DIRECT_CREATE_TYPES,
  LESSON_CHILD_CREATE_TYPES,
  LEGACY_ITEM_TYPES,
  LEGACY_ITEM_TYPE_MAP,
  communityMetadataGaps,
  derivePreparationStatus,
  isCommunityMetadataComplete,
  isCanonicalItemType,
  isLegacyItemType,
  itemTypeOptionsForEdit,
  mapLegacyItemType,
  normalizeContentMetadataPatch,
  normalizeItemType,
  normalizeUnitType,
} from "./contentMetadata.js";

export { deriveContentToc } from "./contentToc.js";

function sb() {
  const client = getSupabase();
  if (!client) throw new Error("no_client");
  return client;
}

async function touchContent(contentId) {
  if (!contentId) return;
  await sb()
    .from("learning_contents")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", contentId);
}

async function contentIdForUnit(unitId) {
  const { data } = await sb().from("content_units").select("content_id").eq("id", unitId).maybeSingle();
  return data?.content_id ?? null;
}

async function contentIdForLesson(lessonId) {
  const { data } = await sb()
    .from("content_lessons")
    .select("unit_id, content_units ( content_id )")
    .eq("id", lessonId)
    .maybeSingle();
  return data?.content_units?.content_id ?? null;
}

async function swapPositions(table, idA, posA, idB, posB) {
  const client = sb();
  const { error: e1 } = await client.from(table).update({ position: posB, updated_at: new Date().toISOString() }).eq("id", idA);
  if (e1) return { ok: false, error: e1.message };
  const { error: e2 } = await client.from(table).update({ position: posA, updated_at: new Date().toISOString() }).eq("id", idB);
  if (e2) return { ok: false, error: e2.message };
  return { ok: true, error: null };
}

function mapContentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility || "private",
    preparation_status: derivePreparationStatus(row),
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...pickContentMetadata(row),
  };
}

const UNIT_SELECT =
  "id, content_id, title, description, position, unit_type, estimated_minutes, created_at, updated_at";
const LESSON_SELECT =
  "id, unit_id, title, description, position, estimated_minutes, created_at, updated_at";
const LESSON_SELECT_WITH_DOC =
  "id, unit_id, title, description, position, estimated_minutes, created_at, updated_at, document_json, document_version";
const ITEM_SELECT =
  "id, lesson_id, type, title, position, content, config, created_at, updated_at";

const PROVENANCE_MIGRATION_HINT =
  "Falta aplicar la migración 20260925100049_learning_content_creator_community_provenance.sql";
const MATERIAL_V2_MIGRATION_HINT =
  "Falta aplicar la migración 20260924100048_material_v2_ownership_copy_metadata.sql";

function isMissingProvenanceColumnError(message) {
  return /original_creator_id|first_community_published/i.test(String(message || ""));
}

function isMissingMaterialV2ColumnError(message) {
  return /language_code|recommended_age|estimated_minutes|difficulty|copied_from/i.test(
    String(message || ""),
  );
}

function isMissingContentV3ColumnError(message) {
  return /parent_lesson_id|preparation_status|completion_rule|grading_mode|passing_score|completion_threshold|learning_objectives|column ["']?required["']?/i.test(
    String(message || ""),
  );
}

function isMissingContentItemsError(message) {
  return /content_items|relation ["']?public\.content_items["']? does not exist/i.test(
    String(message || ""),
  );
}

function migrationErrorMessage(message) {
  if (isMissingProvenanceColumnError(message)) return PROVENANCE_MIGRATION_HINT;
  if (isMissingContentItemsError(message)) return CONTENT_ITEMS_MIGRATION_HINT;
  if (isMissingContentV3ColumnError(message)) return CONTENT_V3_MIGRATION_HINT;
  if (isMissingMaterialV2ColumnError(message)) return MATERIAL_V2_MIGRATION_HINT;
  return null;
}

function mapLessonRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    unit_id: row.unit_id,
    title: row.title,
    description: row.description ?? null,
    position: row.position ?? 0,
    estimated_minutes: row.estimated_minutes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapItemRow(row) {
  if (!row) return null;
  const type = mapLegacyItemType(row.type);
  const config = row.config && typeof row.config === "object" ? row.config : {};
  const content = row.content && typeof row.content === "object" ? row.content : {};
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    type,
    item_type: type,
    title: row.title,
    position: row.position ?? 0,
    content,
    config,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function emptyDocumentContent() {
  return { document_json: [], document_version: 1 };
}

function attachProvenanceNames(row, profileNames) {
  const names = profileNames || {};
  const creatorId = row.original_creator_id || null;
  const publisherId = row.first_community_published_by_id || null;
  return {
    owner_name: row.owner_id ? names[row.owner_id] || null : null,
    original_owner_name: row.original_owner_id ? names[row.original_owner_id] || null : null,
    original_creator_name: creatorId ? names[creatorId] || null : null,
    first_community_published_by_name: publisherId ? names[publisherId] || null : null,
  };
}

async function loadProfileNames(client, ids) {
  const profileNames = {};
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return profileNames;
  const { data: profs } = await client
    .from("profiles")
    .select("id, display_name, email")
    .in("id", unique);
  for (const p of profs ?? []) {
    profileNames[p.id] = p.display_name || p.email || null;
  }
  return profileNames;
}

// --- Contenidos --------------------------------------------------------------

async function selectLearningContents(client, { withUnits = false, ownerId = null, contentId = null } = {}) {
  const unitSuffix = withUnits ? ", content_units ( id )" : "";
  const run = async (selectCols) => {
    let query = client.from("learning_contents").select(`${selectCols}${unitSuffix}`);
    if (ownerId) query = query.eq("owner_id", ownerId).order("updated_at", { ascending: false });
    if (contentId) return query.eq("id", contentId).maybeSingle();
    return query;
  };

  let result = await run(LEARNING_CONTENT_SELECT_BASE);
  if (result.error && /preparation_status/i.test(result.error.message)) {
    result = await run(LEARNING_CONTENT_SELECT_LEGACY);
  }
  return result;
}

export async function listMyContents() {
  const client = sb();
  const { data: session } = await client.auth.getUser();
  const userId = session?.user?.id;
  if (!userId) return { rows: [], error: "no_session" };

  const { data, error } = await selectLearningContents(client, { withUnits: true, ownerId: userId });

  if (error) {
    const hint = migrationErrorMessage(error.message);
    if (hint && !/preparation_status/i.test(error.message)) return { rows: [], error: hint };
    return { rows: [], error: error.message };
  }

  const profileIds = (data ?? []).flatMap((r) => [
    r.owner_id,
    r.original_owner_id,
    r.original_creator_id,
    r.first_community_published_by_id,
  ]);
  const profileNames = await loadProfileNames(client, profileIds);

  const rows = (data ?? []).map((row) => ({
    ...mapContentRow(row),
    unit_count: Array.isArray(row.content_units) ? row.content_units.length : 0,
    ...attachProvenanceNames(row, profileNames),
  }));

  return { rows, error: null };
}

export async function getContent(contentId) {
  const { data, error } = await selectLearningContents(sb(), { contentId });

  if (error) {
    const hint = migrationErrorMessage(error.message);
    // preparation_status missing is handled inside selectLearningContents; other V3-only
    // content columns must not blank the Content screen when still on legacy schema.
    if (hint && !/preparation_status/i.test(error.message)) return { content: null, error: hint };
    return { content: null, error: error.message };
  }
  if (!data) return { content: null, error: "not_found" };
  return { content: mapContentRow(data), error: null };
}

export async function createContent(input = {}) {
  const client = sb();
  const { data: session } = await client.auth.getUser();
  const userId = session?.user?.id;
  if (!userId) return { content: null, error: "no_session" };

  const title = String(input.title ?? "").trim();
  if (!title) return { content: null, error: "title_required" };

  const { patch: meta, error: metaErr } = normalizeContentMetadataPatch(input);
  if (metaErr) return { content: null, error: metaErr };

  const { data, error } = await client
    .from("learning_contents")
    .insert({
      owner_id: userId,
      title,
      description: String(input.description ?? "").trim() || null,
      ...meta,
    })
    .select(LEARNING_CONTENT_SELECT_BASE)
    .single();

  if (error) {
    if (/preparation_status/i.test(error.message)) {
      const { data: legacy, error: legErr } = await client
        .from("learning_contents")
        .insert({
          owner_id: userId,
          title,
          description: String(input.description ?? "").trim() || null,
          ...meta,
        })
        .select(LEARNING_CONTENT_SELECT_LEGACY)
        .single();
      if (legErr) {
        if (/original_creator|first_community/i.test(legErr.message)) {
          return {
            content: null,
            error: "Falta aplicar la migración 20260925100049_learning_content_creator_community_provenance.sql",
          };
        }
        if (/language_code|recommended_age|estimated_minutes|difficulty|check/i.test(legErr.message)) {
          return {
            content: null,
            error: "Falta aplicar la migración 20260924100048_material_v2_ownership_copy_metadata.sql",
          };
        }
        return { content: null, error: legErr.message };
      }
      return { content: mapContentRow(legacy), error: null };
    }
    if (/original_creator|first_community/i.test(error.message)) {
      return {
        content: null,
        error: "Falta aplicar la migración 20260925100049_learning_content_creator_community_provenance.sql",
      };
    }
    if (/language_code|recommended_age|estimated_minutes|difficulty|check/i.test(error.message)) {
      return {
        content: null,
        error: "Falta aplicar la migración 20260924100048_material_v2_ownership_copy_metadata.sql",
      };
    }
    return { content: null, error: error.message };
  }
  return { content: mapContentRow(data), error: null };
}

export async function updateContent(contentId, patch = {}) {
  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim();
  if (patch.description !== undefined) body.description = String(patch.description).trim() || null;
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.visibility !== undefined) body.visibility = patch.visibility;

  const { patch: meta, error: metaErr } = normalizeContentMetadataPatch(patch);
  if (metaErr) return { content: null, error: metaErr };
  Object.assign(body, meta);

  const { data, error } = await sb()
    .from("learning_contents")
    .update(body)
    .eq("id", contentId)
    .select(LEARNING_CONTENT_SELECT_BASE)
    .single();

  if (error) {
    if (/preparation_status/i.test(error.message)) {
      const { data: legacy, error: legErr } = await sb()
        .from("learning_contents")
        .update(body)
        .eq("id", contentId)
        .select(LEARNING_CONTENT_SELECT_LEGACY)
        .single();
      if (legErr) return { content: null, error: legErr.message };
      return { content: mapContentRow(legacy), error: null };
    }
    return { content: null, error: error.message };
  }
  return { content: mapContentRow(data), error: null };
}

export async function deleteContent(contentId) {
  const { error } = await sb().from("learning_contents").delete().eq("id", contentId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

/**
 * Deep-copy via RPC (fail-closed if cannot read). Best-effort media clone afterward.
 * Media: independent clone only when download+reupload under caller path succeeds;
 * otherwise structured copy keeps readable content-media:// refs (limitation reported).
 */
export async function copyLearningContent(sourceContentId) {
  const client = sb();
  const { data: session } = await client.auth.getUser();
  const userId = session?.user?.id;
  if (!userId) return { content: null, error: "no_session", media: { cloned: false, limitation: null } };

  const { data: newId, error } = await client.rpc("copy_learning_content", {
    p_source_id: sourceContentId,
  });

  if (error) {
    const msg = error.message || "";
    if (/forbidden_read/i.test(msg)) return { content: null, error: "forbidden_read", media: { cloned: false, limitation: null } };
    if (/not_authenticated/i.test(msg)) return { content: null, error: "no_session", media: { cloned: false, limitation: null } };
    if (/Could not find the function|copy_learning_content/i.test(msg)) {
      return {
        content: null,
        error: "Falta aplicar la migración 20260924100048_material_v2_ownership_copy_metadata.sql",
        media: { cloned: false, limitation: null },
      };
    }
    return { content: null, error: msg, media: { cloned: false, limitation: null } };
  }

  const { content, error: getErr } = await getContent(newId);
  if (getErr || !content) {
    return { content: null, error: getErr || "copy_fetch_failed", media: { cloned: false, limitation: null } };
  }

  const media = await bestEffortCloneContentMedia({
    client,
    userId,
    sourceContentId,
    newContentId: newId,
  });

  return { content, error: null, media };
}

function collectMediaRefsFromDoc(documentJson, into) {
  const walk = (node) => {
    if (!node) return;
    if (typeof node === "string") {
      if (node.startsWith(CONTENT_MEDIA_SCHEME)) into.add(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(documentJson);
}

async function bestEffortCloneContentMedia({ client, userId, sourceContentId, newContentId }) {
  const limitationBase =
    "Media: se preservan refs content-media:// legibles del origen. Clon independiente completo requiere reescritura de blobs; se intenta best-effort sin service-role.";

  try {
    const { rows: units } = await listContentUnits(newContentId);
    if (!units.length) {
      return { cloned: true, rewritten: 0, limitation: null };
    }

    const newLessonsFlat = [];
    for (const u of units) {
      const { rows } = await listUnitLessons(u.id);
      for (const l of rows) newLessonsFlat.push(l);
    }

    let rewritten = 0;
    let attempted = 0;
    let failed = 0;
    const pathMap = new Map();

    for (let i = 0; i < newLessonsFlat.length; i++) {
      const newLesson = newLessonsFlat[i];
      const { lesson } = await getLesson(newLesson.id);
      if (!lesson) continue;
      const doc = Array.isArray(lesson.document_json) ? lesson.document_json : [];
      const refs = new Set();
      collectMediaRefsFromDoc(doc, refs);
      if (refs.size === 0) continue;

      let changed = false;
      const rewrite = async (node) => {
        if (!node) return node;
        if (typeof node === "string") {
          if (!node.startsWith(CONTENT_MEDIA_SCHEME)) return node;
          attempted += 1;
          if (pathMap.has(node)) {
            changed = true;
            rewritten += 1;
            return pathMap.get(node);
          }
          const parsed = parseContentMediaRef(node);
          if (!parsed) {
            failed += 1;
            return node;
          }
          const { data: blob, error: dlErr } = await client.storage.from(CONTENT_MEDIA_BUCKET).download(parsed.path);
          if (dlErr || !blob) {
            failed += 1;
            return node;
          }
          const newRef = toContentMediaRef(userId, newContentId, newLesson.id, parsed.fileName);
          const newPath = `${userId}/${newContentId}/${newLesson.id}/${parsed.fileName}`;
          const { error: upErr } = await client.storage.from(CONTENT_MEDIA_BUCKET).upload(newPath, blob, {
            cacheControl: "3600",
            upsert: false,
          });
          if (upErr) {
            failed += 1;
            return node;
          }
          pathMap.set(node, newRef);
          changed = true;
          rewritten += 1;
          return newRef;
        }
        if (Array.isArray(node)) {
          const out = [];
          for (const item of node) out.push(await rewrite(item));
          return out;
        }
        if (typeof node === "object") {
          const out = {};
          for (const [k, v] of Object.entries(node)) out[k] = await rewrite(v);
          return out;
        }
        return node;
      };

      const nextDoc = await rewrite(doc);
      if (changed) {
        await saveLessonDocument(newLesson.id, nextDoc, lesson.document_version || 1);
      }
    }

    if (attempted === 0) {
      return { cloned: true, rewritten: 0, limitation: null };
    }
    if (failed > 0) {
      return {
        cloned: false,
        rewritten,
        attempted,
        failed,
        limitation: `${limitationBase} Fallaron ${failed}/${attempted} archivos; refs originales legibles si la fuente sigue siendo readable.`,
      };
    }
    return { cloned: true, rewritten, attempted, failed: 0, limitation: null };
  } catch (e) {
    return {
      cloned: false,
      rewritten: 0,
      limitation: `${limitationBase} (${e?.message || "clone_error"})`,
    };
  }
}

// --- Unidades ----------------------------------------------------------------

export async function listContentUnits(contentId) {
  const { data, error } = await sb()
    .from("content_units")
    .select(UNIT_SELECT)
    .eq("content_id", contentId)
    .order("position", { ascending: true });

  if (error) {
    // Fallback if migration not applied yet
    if (/unit_type|estimated_minutes/i.test(error.message)) {
      const { data: legacy, error: legErr } = await sb()
        .from("content_units")
        .select("id, content_id, title, description, position, created_at, updated_at")
        .eq("content_id", contentId)
        .order("position", { ascending: true });
      if (legErr) return { rows: [], error: legErr.message };
      return {
        rows: (legacy ?? []).map((r) => ({ ...r, unit_type: "unit", estimated_minutes: null })),
        error: null,
      };
    }
    return { rows: [], error: error.message };
  }
  return {
    rows: (data ?? []).map((r) => ({
      ...r,
      unit_type: normalizeUnitType(r.unit_type),
    })),
    error: null,
  };
}

export async function createContentUnit(contentId, { title, description, unitType, estimatedMinutes } = {}) {
  const client = sb();
  const { data: maxRow } = await client
    .from("content_units")
    .select("position")
    .eq("content_id", contentId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (maxRow?.position ?? -1) + 1;
  const insert = {
    content_id: contentId,
    title: String(title ?? "").trim(),
    description: String(description ?? "").trim() || null,
    position,
    unit_type: normalizeUnitType(unitType),
  };
  if (estimatedMinutes !== undefined && estimatedMinutes !== null && estimatedMinutes !== "") {
    insert.estimated_minutes = Number(estimatedMinutes);
  }

  const { data, error } = await client.from("content_units").insert(insert).select(UNIT_SELECT).single();

  if (error) {
    if (/unit_type/i.test(error.message)) {
      const { data: legacy, error: legErr } = await client
        .from("content_units")
        .insert({
          content_id: contentId,
          title: insert.title,
          description: insert.description,
          position,
        })
        .select("id, content_id, title, description, position, created_at, updated_at")
        .single();
      if (legErr) return { unit: null, error: legErr.message };
      await touchContent(contentId);
      return { unit: { ...legacy, unit_type: "unit", estimated_minutes: null }, error: null };
    }
    return { unit: null, error: error.message };
  }
  await touchContent(contentId);
  return { unit: { ...data, unit_type: normalizeUnitType(data.unit_type) }, error: null };
}

export async function updateContentUnit(unitId, patch = {}) {
  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim();
  if (patch.description !== undefined) body.description = String(patch.description).trim() || null;
  if (patch.position !== undefined) body.position = patch.position;
  if (patch.unitType !== undefined || patch.unit_type !== undefined) {
    body.unit_type = normalizeUnitType(patch.unitType ?? patch.unit_type);
  }
  if (patch.estimatedMinutes !== undefined || patch.estimated_minutes !== undefined) {
    const v = patch.estimatedMinutes ?? patch.estimated_minutes;
    body.estimated_minutes = v === null || v === "" ? null : Number(v);
  }

  const { data, error } = await sb().from("content_units").update(body).eq("id", unitId).select(UNIT_SELECT).single();

  if (error) return { unit: null, error: error.message };
  await touchContent(data.content_id);
  return { unit: { ...data, unit_type: normalizeUnitType(data.unit_type) }, error: null };
}

export async function deleteContentUnit(unitId) {
  const contentId = await contentIdForUnit(unitId);
  const { error } = await sb().from("content_units").delete().eq("id", unitId);
  if (error) return { ok: false, error: error.message };
  await touchContent(contentId);
  return { ok: true, error: null };
}

export async function moveContentUnit(unitId, direction) {
  const client = sb();
  const { data: current, error: curErr } = await client
    .from("content_units")
    .select("id, content_id, position")
    .eq("id", unitId)
    .maybeSingle();

  if (curErr) return { ok: false, error: curErr.message };
  if (!current) return { ok: false, error: "not_found" };

  const neighborQuery = client
    .from("content_units")
    .select("id, position")
    .eq("content_id", current.content_id);

  if (direction === "up") {
    neighborQuery.lt("position", current.position).order("position", { ascending: false });
  } else {
    neighborQuery.gt("position", current.position).order("position", { ascending: true });
  }

  const { data: neighbor, error: nErr } = await neighborQuery.limit(1).maybeSingle();
  if (nErr) return { ok: false, error: nErr.message };
  if (!neighbor) return { ok: true, error: null };

  const result = await swapPositions("content_units", current.id, current.position, neighbor.id, neighbor.position);
  if (result.ok) await touchContent(current.content_id);
  return result;
}

// --- Lessons (containers) + content_items (leaves) -----------------------------

function sortByPosition(rows) {
  return [...(rows || [])].sort(
    (a, b) =>
      (a.position ?? 0) - (b.position ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

async function nextLessonPosition(unitId) {
  const { data: maxRow, error } = await sb()
    .from("content_lessons")
    .select("position")
    .eq("unit_id", unitId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { position: null, error: error.message };
  return { position: (maxRow?.position ?? -1) + 1, error: null };
}

async function nextItemPosition(lessonId) {
  const { data: maxRow, error } = await sb()
    .from("content_items")
    .select("position")
    .eq("lesson_id", lessonId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingContentItemsError(error.message)) {
      return { position: null, error: CONTENT_ITEMS_MIGRATION_HINT };
    }
    return { position: null, error: error.message };
  }
  return { position: (maxRow?.position ?? -1) + 1, error: null };
}

export async function listUnitLessons(unitId) {
  const { data, error } = await sb()
    .from("content_lessons")
    .select(LESSON_SELECT)
    .eq("unit_id", unitId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    // Pre-migration polymorphic schema still has parent_lesson_id: list only top-level lessons
    if (/parent_lesson_id|item_type/i.test(error.message)) {
      const { data: mid, error: midErr } = await sb()
        .from("content_lessons")
        .select("id, unit_id, title, description, position, estimated_minutes, created_at, updated_at, parent_lesson_id, item_type")
        .eq("unit_id", unitId)
        .is("parent_lesson_id", null)
        .order("position", { ascending: true })
        .order("id", { ascending: true });
      if (midErr) {
        const { data: legacy, error: legErr } = await sb()
          .from("content_lessons")
          .select(LESSON_SELECT)
          .eq("unit_id", unitId)
          .order("position", { ascending: true });
        if (legErr) return { rows: [], error: legErr.message };
        return {
          rows: sortByPosition(legacy ?? [])
            .filter((r) => (r.item_type == null || r.item_type === "lesson"))
            .map(mapLessonRow),
          error: null,
        };
      }
      return {
        rows: sortByPosition(mid ?? [])
          .filter((r) => (r.item_type || "lesson") === "lesson")
          .map(mapLessonRow),
        error: null,
      };
    }
    return { rows: [], error: error.message };
  }
  return { rows: sortByPosition(data ?? []).map(mapLessonRow), error: null };
}

export async function listLessonItems(lessonId) {
  const { data, error } = await sb()
    .from("content_items")
    .select(ITEM_SELECT)
    .eq("lesson_id", lessonId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    if (isMissingContentItemsError(error.message)) {
      return { rows: [], error: CONTENT_ITEMS_MIGRATION_HINT };
    }
    return { rows: [], error: error.message };
  }
  return { rows: sortByPosition(data ?? []).map(mapItemRow), error: null };
}

/** @deprecated Use listLessonItems — Items are no longer stored as content_lessons children. */
export async function listLessonChildren(parentLessonId) {
  return listLessonItems(parentLessonId);
}

export async function getLesson(lessonId) {
  const { data, error } = await sb()
    .from("content_lessons")
    .select(
      `${LESSON_SELECT_WITH_DOC}, content_units ( content_id, title, position, unit_type )`,
    )
    .eq("id", lessonId)
    .maybeSingle();

  if (error) {
    if (/item_type|parent_lesson_id|unit_type|estimated_minutes/i.test(error.message)) {
      const { data: legacy, error: legErr } = await sb()
        .from("content_lessons")
        .select(
          "id, unit_id, title, description, position, created_at, updated_at, document_json, document_version, content_units ( content_id, title, position )",
        )
        .eq("id", lessonId)
        .maybeSingle();
      if (legErr) return { lesson: null, error: legErr.message };
      if (!legacy) return { lesson: null, error: "not_found" };
      return {
        lesson: {
          ...mapLessonRow(legacy),
          document_json: legacy.document_json,
          document_version: legacy.document_version,
          content_units: legacy.content_units
            ? { ...legacy.content_units, unit_type: "unit" }
            : legacy.content_units,
        },
        error: null,
      };
    }
    return { lesson: null, error: error.message };
  }
  if (!data) return { lesson: null, error: "not_found" };
  return {
    lesson: {
      ...mapLessonRow(data),
      document_json: data.document_json,
      document_version: data.document_version,
      content_units: data.content_units
        ? { ...data.content_units, unit_type: normalizeUnitType(data.content_units.unit_type) }
        : data.content_units,
    },
    error: null,
  };
}

export async function getContentItem(itemId) {
  const { data, error } = await sb()
    .from("content_items")
    .select(
      `${ITEM_SELECT}, content_lessons ( id, unit_id, title, content_units ( content_id, title, position, unit_type ) )`,
    )
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    if (isMissingContentItemsError(error.message)) {
      return { item: null, error: CONTENT_ITEMS_MIGRATION_HINT };
    }
    return { item: null, error: error.message };
  }
  if (!data) return { item: null, error: "not_found" };
  const mapped = mapItemRow(data);
  const lesson = data.content_lessons || null;
  return {
    item: {
      ...mapped,
      content_lessons: lesson
        ? {
            ...lesson,
            content_units: lesson.content_units
              ? {
                  ...lesson.content_units,
                  unit_type: normalizeUnitType(lesson.content_units.unit_type),
                }
              : lesson.content_units,
          }
        : null,
    },
    error: null,
  };
}

export async function saveLessonDocument(lessonId, documentJson, documentVersion = 1) {
  const { data, error } = await sb()
    .from("content_lessons")
    .update({
      document_json: documentJson,
      document_version: Number(documentVersion || 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lessonId)
    .select("id, unit_id, title, document_json, document_version, updated_at")
    .single();

  if (error) return { lesson: null, error: error.message };
  const contentId = await contentIdForUnit(data.unit_id);
  await touchContent(contentId);
  return { lesson: data, error: null };
}

export async function saveContentItemDocument(itemId, documentJson, documentVersion = 1) {
  const { item: current, error: curErr } = await getContentItem(itemId);
  if (curErr || !current) return { item: null, error: curErr || "not_found" };
  const nextVersion = Number(documentVersion || current.content?.document_version || 1) + 1;
  const content = {
    ...(current.content || {}),
    document_json: documentJson,
    document_version: nextVersion,
  };
  const { data, error } = await sb()
    .from("content_items")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .select(ITEM_SELECT)
    .single();
  if (error) return { item: null, error: error.message };
  const contentId = await contentIdForLesson(data.lesson_id);
  await touchContent(contentId);
  return { item: mapItemRow(data), error: null };
}

/**
 * Create a Lesson under a Unit. Does not create Items.
 * parentLessonId / non-lesson itemType are rejected (no Unit->Item, no Lesson->Lesson).
 */
export async function createLesson(unitId, { title, description, estimatedMinutes, parentLessonId = null, itemType } = {}) {
  if (parentLessonId) {
    return { lesson: null, error: "invalid_hierarchy: lesson_under_lesson" };
  }
  if (itemType != null && String(itemType).trim() && String(itemType).trim() !== "lesson") {
    return { lesson: null, error: "invalid_item_type_for_unit" };
  }

  const { position, error: posErr } = await nextLessonPosition(unitId);
  if (posErr) return { lesson: null, error: posErr };

  const insert = {
    unit_id: unitId,
    title: String(title ?? "").trim(),
    description: String(description ?? "").trim() || null,
    position,
  };
  if (estimatedMinutes !== undefined && estimatedMinutes !== null && estimatedMinutes !== "") {
    insert.estimated_minutes = Number(estimatedMinutes);
  }

  const { data, error } = await sb().from("content_lessons").insert(insert).select(LESSON_SELECT).single();
  if (error) return { lesson: null, error: error.message };
  await touchContent(await contentIdForUnit(unitId));
  return { lesson: mapLessonRow(data), error: null };
}

export async function createContentItem(
  lessonId,
  { title, type, content, config, position: explicitPosition } = {},
) {
  const normalizedType = normalizeItemType(type);
  if (!isCanonicalItemType(normalizedType)) {
    return { item: null, error: "invalid_item_type" };
  }
  if (normalizedType === "lesson") {
    return { item: null, error: "invalid_hierarchy: lesson_is_not_item" };
  }

  const { lesson, error: lessonErr } = await getLesson(lessonId);
  if (lessonErr || !lesson) return { item: null, error: lessonErr || "lesson_not_found" };

  let position = explicitPosition;
  if (position == null) {
    const next = await nextItemPosition(lessonId);
    if (next.error) return { item: null, error: next.error };
    position = next.position;
  }

  const insert = {
    lesson_id: lessonId,
    type: normalizedType,
    title: String(title ?? "").trim() || normalizedType,
    position,
    content: content && typeof content === "object" ? content : emptyDocumentContent(),
    config: config && typeof config === "object" ? config : {},
  };

  const { data, error } = await sb().from("content_items").insert(insert).select(ITEM_SELECT).single();
  if (error) {
    if (isMissingContentItemsError(error.message)) {
      return { item: null, error: CONTENT_ITEMS_MIGRATION_HINT };
    }
    return { item: null, error: error.message };
  }
  await touchContent(await contentIdForLesson(lessonId));
  return { item: mapItemRow(data), error: null };
}

export async function updateLesson(lessonId, patch = {}) {
  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim();
  if (patch.description !== undefined) body.description = String(patch.description).trim() || null;
  if (patch.position !== undefined) body.position = patch.position;
  if (patch.estimatedMinutes !== undefined || patch.estimated_minutes !== undefined) {
    const v = patch.estimatedMinutes ?? patch.estimated_minutes;
    body.estimated_minutes = v === null || v === "" ? null : Number(v);
  }
  // Reject attempts to treat lessons as typed items
  if (patch.itemType !== undefined || patch.item_type !== undefined) {
    const t = String(patch.itemType ?? patch.item_type).trim();
    if (t && t !== "lesson") {
      return { lesson: null, error: "invalid_hierarchy: lesson_has_no_item_type" };
    }
  }

  const { data, error } = await sb()
    .from("content_lessons")
    .update(body)
    .eq("id", lessonId)
    .select(LESSON_SELECT)
    .single();

  if (error) return { lesson: null, error: error.message };
  await touchContent(await contentIdForUnit(data.unit_id));
  return { lesson: mapLessonRow(data), error: null };
}

export async function updateContentItem(itemId, patch = {}) {
  const { item: current, error: curErr } = await getContentItem(itemId);
  if (curErr || !current) return { item: null, error: curErr || "not_found" };

  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim();
  if (patch.position !== undefined) body.position = patch.position;
  if (patch.content !== undefined) body.content = patch.content;
  if (patch.config !== undefined) body.config = patch.config;

  const nextTypeRaw = patch.type ?? patch.itemType ?? patch.item_type;
  if (nextTypeRaw !== undefined) {
    const nextType = normalizeItemType(nextTypeRaw);
    if (!isCanonicalItemType(nextType)) {
      return { item: null, error: "invalid_item_type" };
    }
    body.type = nextType;
  }

  const { data, error } = await sb()
    .from("content_items")
    .update(body)
    .eq("id", itemId)
    .select(ITEM_SELECT)
    .single();

  if (error) return { item: null, error: error.message };
  await touchContent(await contentIdForLesson(data.lesson_id));
  return { item: mapItemRow(data), error: null };
}

export async function deleteLesson(lessonId) {
  const { data: lesson } = await sb().from("content_lessons").select("unit_id").eq("id", lessonId).maybeSingle();
  const contentId = lesson?.unit_id ? await contentIdForUnit(lesson.unit_id) : null;
  const { error } = await sb().from("content_lessons").delete().eq("id", lessonId);
  if (error) return { ok: false, error: error.message };
  await touchContent(contentId);
  return { ok: true, error: null };
}

export async function deleteContentItem(itemId) {
  const { data: item } = await sb().from("content_items").select("lesson_id").eq("id", itemId).maybeSingle();
  const contentId = item?.lesson_id ? await contentIdForLesson(item.lesson_id) : null;
  const { error } = await sb().from("content_items").delete().eq("id", itemId);
  if (error) {
    if (isMissingContentItemsError(error.message)) return { ok: false, error: CONTENT_ITEMS_MIGRATION_HINT };
    return { ok: false, error: error.message };
  }
  await touchContent(contentId);
  return { ok: true, error: null };
}

export async function moveLesson(lessonId, direction) {
  const client = sb();
  const { data: current, error: curErr } = await client
    .from("content_lessons")
    .select("id, unit_id, position")
    .eq("id", lessonId)
    .maybeSingle();

  if (curErr) return { ok: false, error: curErr.message };
  if (!current) return { ok: false, error: "not_found" };

  const neighborQuery = client
    .from("content_lessons")
    .select("id, position")
    .eq("unit_id", current.unit_id);

  if (direction === "up") {
    neighborQuery.lt("position", current.position).order("position", { ascending: false });
  } else {
    neighborQuery.gt("position", current.position).order("position", { ascending: true });
  }

  const { data: neighbor, error: nErr } = await neighborQuery.limit(1).maybeSingle();
  if (nErr) return { ok: false, error: nErr.message };
  if (!neighbor) return { ok: true, error: null };

  const result = await swapPositions(
    "content_lessons",
    current.id,
    current.position,
    neighbor.id,
    neighbor.position,
  );
  if (result.ok) await touchContent(await contentIdForUnit(current.unit_id));
  return result;
}

export async function moveContentItem(itemId, direction) {
  const client = sb();
  const { data: current, error: curErr } = await client
    .from("content_items")
    .select("id, lesson_id, position")
    .eq("id", itemId)
    .maybeSingle();

  if (curErr) {
    if (isMissingContentItemsError(curErr.message)) return { ok: false, error: CONTENT_ITEMS_MIGRATION_HINT };
    return { ok: false, error: curErr.message };
  }
  if (!current) return { ok: false, error: "not_found" };

  const neighborQuery = client
    .from("content_items")
    .select("id, position")
    .eq("lesson_id", current.lesson_id);

  if (direction === "up") {
    neighborQuery.lt("position", current.position).order("position", { ascending: false });
  } else {
    neighborQuery.gt("position", current.position).order("position", { ascending: true });
  }

  const { data: neighbor, error: nErr } = await neighborQuery.limit(1).maybeSingle();
  if (nErr) return { ok: false, error: nErr.message };
  if (!neighbor) return { ok: true, error: null };

  const result = await swapPositions(
    "content_items",
    current.id,
    current.position,
    neighbor.id,
    neighbor.position,
  );
  if (result.ok) await touchContent(await contentIdForLesson(current.lesson_id));
  return result;
}

/** Move Lesson between Units; preserves Lesson ID and all Item IDs. */
export async function moveLessonToUnit(lessonId, unitId) {
  if (!unitId) return { ok: false, error: "unit_required" };
  const { lesson: current, error: curErr } = await getLesson(lessonId);
  if (curErr || !current) return { ok: false, error: curErr || "not_found" };

  const { position, error: posErr } = await nextLessonPosition(unitId);
  if (posErr) return { ok: false, error: posErr };

  const { data, error } = await sb()
    .from("content_lessons")
    .update({
      unit_id: unitId,
      position,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lessonId)
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  if (!data || data.id !== lessonId) return { ok: false, error: "id_changed" };
  await touchContent(await contentIdForUnit(unitId));
  return { ok: true, error: null };
}

/** Move Item between Lessons; preserves Item ID. */
export async function moveItemToLesson(itemId, lessonId) {
  if (!lessonId) return { ok: false, error: "lesson_required" };
  const { item: current, error: curErr } = await getContentItem(itemId);
  if (curErr || !current) return { ok: false, error: curErr || "not_found" };
  const { lesson, error: lessonErr } = await getLesson(lessonId);
  if (lessonErr || !lesson) return { ok: false, error: lessonErr || "lesson_not_found" };

  const { position, error: posErr } = await nextItemPosition(lessonId);
  if (posErr) return { ok: false, error: posErr };

  const { data, error } = await sb()
    .from("content_items")
    .update({
      lesson_id: lessonId,
      position,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  if (!data || data.id !== itemId) return { ok: false, error: "id_changed" };
  await touchContent(await contentIdForLesson(lessonId));
  return { ok: true, error: null };
}

/**
 * @deprecated Prefer moveLessonToUnit / moveItemToLesson.
 * Kept for transitional callers: lessons move by unitId; items by parentLessonId.
 */
export async function moveLessonToContainer(entityId, { unitId, parentLessonId = null } = {}) {
  if (parentLessonId) {
    // Treat as moving an Item into a Lesson
    return moveItemToLesson(entityId, parentLessonId);
  }
  return moveLessonToUnit(entityId, unitId);
}

export async function duplicateContentItem(itemId) {
  const { item, error } = await getContentItem(itemId);
  if (error || !item) return { item: null, error: error || "not_found" };
  const { position, error: posErr } = await nextItemPosition(item.lesson_id);
  if (posErr) return { item: null, error: posErr };
  return createContentItem(item.lesson_id, {
    title: `${item.title} (copia)`,
    type: item.type,
    content: JSON.parse(JSON.stringify(item.content || {})),
    config: JSON.parse(JSON.stringify(item.config || {})),
    position,
  });
}

export async function duplicateLesson(lessonId) {
  const { lesson, error } = await getLesson(lessonId);
  if (error || !lesson) return { lesson: null, error: error || "not_found" };
  const { lesson: created, error: createErr } = await createLesson(lesson.unit_id, {
    title: `${lesson.title} (copia)`,
    description: lesson.description,
    estimatedMinutes: lesson.estimated_minutes,
  });
  if (createErr || !created) return { lesson: null, error: createErr || "create_failed" };

  const { rows: items } = await listLessonItems(lessonId);
  for (const it of items) {
    const { error: itemErr } = await createContentItem(created.id, {
      title: it.title,
      type: it.type,
      content: JSON.parse(JSON.stringify(it.content || {})),
      config: JSON.parse(JSON.stringify(it.config || {})),
      position: it.position,
    });
    if (itemErr) return { lesson: null, error: itemErr };
  }
  return { lesson: created, error: null };
}

export async function duplicateContentUnit(unitId) {
  const { data: unit, error: uErr } = await sb()
    .from("content_units")
    .select(UNIT_SELECT)
    .eq("id", unitId)
    .maybeSingle();
  if (uErr || !unit) return { unit: null, error: uErr?.message || "not_found" };

  const { unit: created, error: createErr } = await createContentUnit(unit.content_id, {
    title: `${unit.title} (copia)`,
    description: unit.description,
    unitType: unit.unit_type,
    estimatedMinutes: unit.estimated_minutes,
  });
  if (createErr || !created) return { unit: null, error: createErr || "create_failed" };

  const { rows: lessons } = await listUnitLessons(unitId);
  for (const lesson of lessons) {
    const { lesson: newLesson, error: lErr } = await createLesson(created.id, {
      title: lesson.title,
      description: lesson.description,
      estimatedMinutes: lesson.estimated_minutes,
    });
    if (lErr || !newLesson) return { unit: null, error: lErr || "lesson_copy_failed" };
    const { rows: items } = await listLessonItems(lesson.id);
    for (const it of items) {
      const { error: itemErr } = await createContentItem(newLesson.id, {
        title: it.title,
        type: it.type,
        content: JSON.parse(JSON.stringify(it.content || {})),
        config: JSON.parse(JSON.stringify(it.config || {})),
        position: it.position,
      });
      if (itemErr) return { unit: null, error: itemErr };
    }
  }
  return { unit: created, error: null };
}

// --- Bloques -----------------------------------------------------------------

export async function listLessonBlocks(lessonId) {
  const { data, error } = await sb()
    .from("lesson_blocks")
    .select("id, lesson_id, block_type, title, content, starter_code, position, metadata, created_at, updated_at")
    .eq("lesson_id", lessonId)
    .order("position", { ascending: true });

  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

export async function createLessonBlock(lessonId, { blockType, title, content, starterCode }) {
  const client = sb();
  if (!BLOCK_TYPES[blockType]) return { block: null, error: "invalid_block_type" };

  const { data: maxRow } = await client
    .from("lesson_blocks")
    .select("position")
    .eq("lesson_id", lessonId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (maxRow?.position ?? -1) + 1;

  const { data, error } = await client
    .from("lesson_blocks")
    .insert({
      lesson_id: lessonId,
      block_type: blockType,
      title: String(title ?? "").trim() || null,
      content: content ?? "",
      starter_code: starterCode ?? null,
      position,
    })
    .select("id, lesson_id, block_type, title, content, starter_code, position, metadata, created_at, updated_at")
    .single();

  if (error) return { block: null, error: error.message };
  const contentId = await contentIdForLesson(lessonId);
  await touchContent(contentId);
  return { block: data, error: null };
}

export async function updateLessonBlock(blockId, patch) {
  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim() || null;
  if (patch.content !== undefined) body.content = patch.content ?? "";
  if (patch.starterCode !== undefined) body.starter_code = patch.starterCode || null;
  if (patch.position !== undefined) body.position = patch.position;
  if (patch.blockType !== undefined) body.block_type = patch.blockType;

  const { data, error } = await sb()
    .from("lesson_blocks")
    .update(body)
    .eq("id", blockId)
    .select("id, lesson_id, block_type, title, content, starter_code, position, metadata, created_at, updated_at")
    .single();

  if (error) return { block: null, error: error.message };
  const contentId = await contentIdForLesson(data.lesson_id);
  await touchContent(contentId);
  return { block: data, error: null };
}

export async function deleteLessonBlock(blockId) {
  const { data: block } = await sb().from("lesson_blocks").select("lesson_id").eq("id", blockId).maybeSingle();
  const contentId = block?.lesson_id ? await contentIdForLesson(block.lesson_id) : null;
  const { error } = await sb().from("lesson_blocks").delete().eq("id", blockId);
  if (error) return { ok: false, error: error.message };
  await touchContent(contentId);
  return { ok: true, error: null };
}

export async function moveLessonBlock(blockId, direction) {
  const client = sb();
  const { data: current, error: curErr } = await client
    .from("lesson_blocks")
    .select("id, lesson_id, position")
    .eq("id", blockId)
    .maybeSingle();

  if (curErr) return { ok: false, error: curErr.message };
  if (!current) return { ok: false, error: "not_found" };

  const neighborQuery = client
    .from("lesson_blocks")
    .select("id, position")
    .eq("lesson_id", current.lesson_id);

  if (direction === "up") {
    neighborQuery.lt("position", current.position).order("position", { ascending: false });
  } else {
    neighborQuery.gt("position", current.position).order("position", { ascending: true });
  }

  const { data: neighbor, error: nErr } = await neighborQuery.limit(1).maybeSingle();
  if (nErr) return { ok: false, error: nErr.message };
  if (!neighbor) return { ok: true, error: null };

  const result = await swapPositions("lesson_blocks", current.id, current.position, neighbor.id, neighbor.position);
  if (result.ok) {
    const contentId = await contentIdForLesson(current.lesson_id);
    await touchContent(contentId);
  }
  return result;
}
