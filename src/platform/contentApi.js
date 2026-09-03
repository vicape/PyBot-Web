import { getSupabase } from "../supabaseClient.js";

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

// --- Contenidos --------------------------------------------------------------

export async function listMyContents() {
  const { data, error } = await sb()
    .from("learning_contents")
    .select("id, title, description, status, created_at, updated_at, content_units ( id )")
    .order("updated_at", { ascending: false });

  if (error) return { rows: [], error: error.message };

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    unit_count: Array.isArray(row.content_units) ? row.content_units.length : 0,
  }));

  return { rows, error: null };
}

export async function getContent(contentId) {
  const { data, error } = await sb()
    .from("learning_contents")
    .select("id, title, description, status, created_at, updated_at")
    .eq("id", contentId)
    .maybeSingle();

  if (error) return { content: null, error: error.message };
  if (!data) return { content: null, error: "not_found" };
  return { content: data, error: null };
}

export async function createContent({ title, description }) {
  const client = sb();
  const { data: session } = await client.auth.getUser();
  const userId = session?.user?.id;
  if (!userId) return { content: null, error: "no_session" };

  const { data, error } = await client
    .from("learning_contents")
    .insert({
      owner_id: userId,
      title: String(title ?? "").trim(),
      description: String(description ?? "").trim() || null,
    })
    .select("id, title, description, status, created_at, updated_at")
    .single();

  if (error) return { content: null, error: error.message };
  return { content: data, error: null };
}

export async function updateContent(contentId, patch) {
  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim();
  if (patch.description !== undefined) body.description = String(patch.description).trim() || null;
  if (patch.status !== undefined) body.status = patch.status;

  const { data, error } = await sb()
    .from("learning_contents")
    .update(body)
    .eq("id", contentId)
    .select("id, title, description, status, created_at, updated_at")
    .single();

  if (error) return { content: null, error: error.message };
  return { content: data, error: null };
}

export async function deleteContent(contentId) {
  const { error } = await sb().from("learning_contents").delete().eq("id", contentId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

// --- Unidades ----------------------------------------------------------------

export async function listContentUnits(contentId) {
  const { data, error } = await sb()
    .from("content_units")
    .select("id, content_id, title, description, position, created_at, updated_at")
    .eq("content_id", contentId)
    .order("position", { ascending: true });

  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

export async function createContentUnit(contentId, { title, description }) {
  const client = sb();
  const { data: maxRow } = await client
    .from("content_units")
    .select("position")
    .eq("content_id", contentId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (maxRow?.position ?? -1) + 1;

  const { data, error } = await client
    .from("content_units")
    .insert({
      content_id: contentId,
      title: String(title ?? "").trim(),
      description: String(description ?? "").trim() || null,
      position,
    })
    .select("id, content_id, title, description, position, created_at, updated_at")
    .single();

  if (error) return { unit: null, error: error.message };
  await touchContent(contentId);
  return { unit: data, error: null };
}

export async function updateContentUnit(unitId, patch) {
  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim();
  if (patch.description !== undefined) body.description = String(patch.description).trim() || null;
  if (patch.position !== undefined) body.position = patch.position;

  const { data, error } = await sb()
    .from("content_units")
    .update(body)
    .eq("id", unitId)
    .select("id, content_id, title, description, position, created_at, updated_at")
    .single();

  if (error) return { unit: null, error: error.message };
  await touchContent(data.content_id);
  return { unit: data, error: null };
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

// --- Lecciones ---------------------------------------------------------------

export async function listUnitLessons(unitId) {
  const { data, error } = await sb()
    .from("content_lessons")
    .select("id, unit_id, title, description, position, created_at, updated_at")
    .eq("unit_id", unitId)
    .order("position", { ascending: true });

  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

export async function getLesson(lessonId) {
  const { data, error } = await sb()
    .from("content_lessons")
    .select(
      "id, unit_id, title, description, position, created_at, updated_at, document_json, document_version, content_units ( content_id, title, position )",
    )
    .eq("id", lessonId)
    .maybeSingle();

  if (error) return { lesson: null, error: error.message };
  if (!data) return { lesson: null, error: "not_found" };
  return { lesson: data, error: null };
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

export async function createLesson(unitId, { title, description }) {
  const client = sb();
  const contentId = await contentIdForUnit(unitId);

  const { data: maxRow } = await client
    .from("content_lessons")
    .select("position")
    .eq("unit_id", unitId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (maxRow?.position ?? -1) + 1;

  const { data, error } = await client
    .from("content_lessons")
    .insert({
      unit_id: unitId,
      title: String(title ?? "").trim(),
      description: String(description ?? "").trim() || null,
      position,
    })
    .select("id, unit_id, title, description, position, created_at, updated_at")
    .single();

  if (error) return { lesson: null, error: error.message };
  await touchContent(contentId);
  return { lesson: data, error: null };
}

export async function updateLesson(lessonId, patch) {
  const body = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = String(patch.title).trim();
  if (patch.description !== undefined) body.description = String(patch.description).trim() || null;
  if (patch.position !== undefined) body.position = patch.position;

  const { data, error } = await sb()
    .from("content_lessons")
    .update(body)
    .eq("id", lessonId)
    .select("id, unit_id, title, description, position, created_at, updated_at")
    .single();

  if (error) return { lesson: null, error: error.message };
  const contentId = await contentIdForUnit(data.unit_id);
  await touchContent(contentId);
  return { lesson: data, error: null };
}

export async function deleteLesson(lessonId) {
  const { data: lesson } = await sb().from("content_lessons").select("unit_id").eq("id", lessonId).maybeSingle();
  const contentId = lesson?.unit_id ? await contentIdForUnit(lesson.unit_id) : null;
  const { error } = await sb().from("content_lessons").delete().eq("id", lessonId);
  if (error) return { ok: false, error: error.message };
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

  const result = await swapPositions("content_lessons", current.id, current.position, neighbor.id, neighbor.position);
  if (result.ok) {
    const contentId = await contentIdForUnit(current.unit_id);
    await touchContent(contentId);
  }
  return result;
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
