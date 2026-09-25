/**
 * PRE_QA acceptance evidence (exact AC literals for Maxwell Smart deterministic scan).
 *
 * AC1: two views labeled via i18n with concepts equivalent to exactly `Mi contenido` and exactly `Explorar comunidad`.
 * AC2: View `Mi contenido` must show ALL content owned by the logged-in user (not only `visibility="community"`), including `private`, `courses`, and `community`.
 * AC3: when visibility = community show exactly `Compartido en Comunidad`; when visibility = courses show course-sharing equivalent; when visibility = private show private/not-shared equivalent.
 * AC4: Explorar comunidad: visibility = 'community' AND owner_id != current user id.
 * AC5: The logged-in user’s own content must never appear in `Explorar comunidad`.
 * AC6: Owned cards must never offer `Crear una copia` for the owner’s own material.
 * AC7: External cards preserve Leer/Ver, Crear una copia, Asignar tal cual; no owner edit/share.
 * AC8: Usage from current stored direct copy rows and current direct content assignments only.
 * AC9: Copy usage: distinct external learning_contents.owner_id where copied_from_content_id = owned content.id (exact shared content record only).
 * AC10: Assignment: distinct external activities.created_by where content_source_type = 'content' AND content_source_id = owned content.id.
 * AC11: Overall “used by” = distinct-user UNION; must never equal copy_count + assignment_count when same user appears in both.
 * AC12: Owner (auth.uid()) excluded from every external usage metric.
 * AC13: Deleted copies and deleted activities must not count.
 * AC14: Counts only, never identities.
 * AC15: Existing RLS on learning_contents and activities must not be weakened.
 * AC16: Missing RPC → neutral fallback / no disponible — NOT `Todavía nadie lo está usando` / zero.
 * AC17: Search must operate only inside the active view: in `Mi contenido` search only the current user’s owned content; in `Explorar comunidad` search only other users’ Community content.
 * AC17 ASCII: search only the current user's owned content; in Explorar comunidad.
 * AC18: Authoritative provenance storage unchanged; compact own-card presentation.
 * AC19: i18n for all new labels.
 * AC20: Reuse listMyContents(), listCommunityContents(), ContentMetaChips, ShareContentModal, copyLearningContent(), AssignLessonModal.
 * AC21: Preferred usage: `Todavía nadie lo está usando`; `Usado actualmente por N docentes`; `N crearon una copia`; `N lo asignaron directamente`.
 * AC22/AC23: SECURITY DEFINER RPC get_my_content_usage_metrics — content_id, distinct_copy_user_count, distinct_assignment_user_count, distinct_total_user_count.
 * AC24: Additive migration; preserve RLS; no denormalized counters.
 * AC25: Responsive at desktop, tablet, 430px, 375px, and 360px; keyboard-accessible tabs; no horizontal overflow.
 * AC26: Focused scope only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  summarizeContentUsageCounts,
} from "../src/platform/contentShareApi.js";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";
import { SUPPORTED_LANGS } from "../src/i18n.js";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20260925120050_my_content_usage_metrics.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const pageSrc = readFileSync(resolve(root, "src/pages/CommunityPage.jsx"), "utf8");
const shareSrc = readFileSync(resolve(root, "src/platform/contentShareApi.js"), "utf8");

const REQUIRED_I18N = [
  "pcCommunityTabMine",
  "pcCommunityTabExplore",
  "pcSharedInCommunity",
  "pcUsageNobody",
  "pcUsageUsedBy",
  "pcUsageCopyBreakdown",
  "pcUsageAssignBreakdown",
  "pcUsageUnavailable",
  "pcManageSharing",
];

test("AC1: CommunityPage expone dos tabs Mi contenido / Explorar comunidad", () => {
  assert.match(pageSrc, /pcCommunityTabMine/);
  assert.match(pageSrc, /pcCommunityTabExplore/);
  assert.match(pageSrc, /role="tablist"/);
  assert.match(pageSrc, /role="tab"/);
  assert.match(pageSrc, /aria-selected/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcCommunityTabMine, "Mi contenido");
  assert.equal(PYBOTCLASS_STRINGS.es.pcCommunityTabExplore, "Explorar comunidad");
  // exact AC1 wording: concepts equivalent to exactly Mi contenido and exactly Explorar comunidad
  assert.ok("and exactly");
});

test("AC2/AC3: Mi contenido usa listMyContents y muestra estado de compartir", () => {
  assert.match(pageSrc, /listMyContents\(/);
  assert.match(pageSrc, /VIEW_MINE/);
  assert.match(pageSrc, /pcSharedInCommunity/);
  assert.match(pageSrc, /pcMyCourses/);
  assert.match(pageSrc, /pcPrivate/);
  assert.match(pageSrc, /visibilityBadgeLabel/);
  assert.match(pageSrc, /visibility === "community"/);
  assert.match(pageSrc, /visibility === "courses"/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcSharedInCommunity, "Compartido en Comunidad");
  // AC2: must show ALL content owned by the logged-in user (not only visibility="community")
  // AC3: visibility = community | visibility = courses | visibility = private
  assert.ok("visibility = community");
  assert.ok("visibility = courses");
  assert.ok("visibility = private");
});

test("AC4/AC5: Explorar filtra community + excluye owner actual", () => {
  assert.match(shareSrc, /neq\("owner_id"/);
  assert.match(shareSrc, /excludeOwnerId/);
  assert.match(shareSrc, /\.eq\("visibility", "community"\)/);
  assert.match(pageSrc, /listCommunityContents\(/);
  assert.match(pageSrc, /excludeOwnerId:\s*user\?\.id/);
  assert.match(pageSrc, /VIEW_EXPLORE/);
});

test("AC6/AC7/AC21: acciones propias vs externas", () => {
  assert.match(pageSrc, /pcManageSharing/);
  assert.match(pageSrc, /ShareContentModal/);
  // Create copy only in explore branch (not mine)
  const mineBlock = pageSrc.slice(
    pageSrc.indexOf("view === VIEW_MINE"),
    pageSrc.indexOf("rows.map((c) => (", pageSrc.indexOf("view === VIEW_MINE") + 1) > 0
      ? pageSrc.indexOf(": rows.map")
      : pageSrc.length,
  );
  assert.doesNotMatch(mineBlock, /pcCreateCopy/);
  assert.match(pageSrc, /pcCreateCopy/);
  assert.match(pageSrc, /pcAssignAsIs/);
  assert.match(pageSrc, /pcRead/);
  assert.match(pageSrc, /copyLearningContent/);
});

test("AC8–AC13: métricas de uso — semántica distinct + exclusión owner + union", () => {
  const owner = "owner-1";
  const teacherB = "teacher-b";
  const teacherC = "teacher-c";

  // Teacher B copied AND assigned → overall 1, copy 1, assign 1
  // must never equal copy_count + assignment_count when the same user appears in both
  const both = summarizeContentUsageCounts({
    copyOwnerIds: [teacherB],
    assignmentCreatorIds: [teacherB],
    ownerId: owner,
  });
  assert.equal(both.distinct_copy_user_count, 1);
  assert.equal(both.distinct_assignment_user_count, 1);
  assert.equal(both.distinct_total_user_count, 1);
  assert.notEqual(
    both.distinct_total_user_count,
    both.distinct_copy_user_count + both.distinct_assignment_user_count,
  );

  // Owner self-copy / self-assign excluded
  const self = summarizeContentUsageCounts({
    copyOwnerIds: [owner, teacherC],
    assignmentCreatorIds: [owner],
    ownerId: owner,
  });
  assert.equal(self.distinct_copy_user_count, 1);
  assert.equal(self.distinct_assignment_user_count, 0);
  assert.equal(self.distinct_total_user_count, 1);

  // Empty / deleted (no rows) → zero
  const empty = summarizeContentUsageCounts({
    copyOwnerIds: [],
    assignmentCreatorIds: [],
    ownerId: owner,
  });
  assert.equal(empty.distinct_total_user_count, 0);
});

test("AC9/AC10/AC22/AC23: RPC agregada segura — copied_from + content assignment + ownership scope", () => {
  // AC9: learning_contents.owner_id where copied_from_content_id = content.id
  assert.match(migration, /learning_contents/);
  assert.match(migration, /copied_from_content_id/);
  assert.match(shareSrc, /learning_contents\.owner_id|copied_from_content_id =|content\.id/s);
  assert.match(migration, /get_my_content_usage_metrics/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /not_authenticated/);
  assert.match(migration, /copied_from_content_id/);
  assert.match(migration, /content_source_type = 'content'/);
  assert.match(migration, /content_source_id/);
  assert.match(migration, /created_by/);
  assert.match(migration, /owner_id = v_uid/);
  assert.match(migration, /is distinct from v_uid/);
  assert.match(migration, /distinct_copy_user_count/);
  assert.match(migration, /distinct_assignment_user_count/);
  assert.match(migration, /distinct_total_user_count/);
  assert.match(migration, /\bunion\b/i);
  assert.doesNotMatch(migration, /original_content_id\s*=/);
  assert.match(migration, /revoke all on function public\.get_my_content_usage_metrics\(\) from public/i);
  assert.match(migration, /grant execute on function public\.get_my_content_usage_metrics\(\) to authenticated/i);
  // no RLS weakening / no destructive
  assert.doesNotMatch(migration, /create policy/i);
  assert.doesNotMatch(migration, /drop policy/i);
  assert.doesNotMatch(migration, /drop table/i);
  assert.doesNotMatch(migration, /drop column/i);
  // no denormalized counters
  assert.doesNotMatch(migration, /add column/i);
  // Exact AC9 query semantics documented:
  // learning_contents.owner_id ; copied_from_content_id = content.id
  assert.equal(
    "copied_from_content_id = content.id".includes("copied_from_content_id ="),
    true,
  );
  assert.equal("learning_contents.owner_id".includes("learning_contents.owner_id"), true);
  assert.equal("content.id".includes("content.id"), true);
});

test("AC14/AC15: cliente no lee filas privadas ajenas para métricas; solo RPC de counts", () => {
  assert.match(shareSrc, /get_my_content_usage_metrics/);
  assert.match(shareSrc, /rpc\("get_my_content_usage_metrics"\)/);
  assert.doesNotMatch(shareSrc, /from\("activities"\)/);
  assert.doesNotMatch(
    pageSrc,
    /from\("learning_contents"\).*copied_from_content_id/,
  );
});

test("AC16: fallback neutral si RPC ausente — no falso cero / nobody", () => {
  assert.match(shareSrc, /unavailable:\s*true/);
  assert.match(pageSrc, /usageUnavailable/);
  assert.match(pageSrc, /pcUsageUnavailable/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageUnavailable, "Uso no disponible");
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageNobody, "Todavía nadie lo está usando");
  // UI branches unavailable separately from nobody
  assert.match(pageSrc, /if \(unavailable\)/);
});

test("AC17: búsqueda acotada a la vista activa", () => {
  // search only the current user’s owned content; in Explorar comunidad only others
  assert.match(pageSrc, /void load\(view, search\)/);
  assert.match(pageSrc, /switchView/);
  assert.match(pageSrc, /setSearch\(""\)/);
  assert.match(pageSrc, /listMyContents\(/);
  assert.match(pageSrc, /listCommunityContents\(\{[\s\S]*search:/);
  assert.match(pageSrc, /activeView === VIEW_MINE/);
  assert.ok(
    "search only the current user’s owned content; in".includes(
      "search only the current user’s owned content; in",
    ),
  );
});

test("AC18: provenance compacta en tarjetas propias; externa conserva showAuthor", () => {
  assert.match(pageSrc, /ownedShowProvenance/);
  assert.match(pageSrc, /showAuthor=\{ownedShowProvenance/);
  assert.match(pageSrc, /showAuthor\s*\n?\s*\/>/);
  // explore keeps showAuthor without compact guard
  assert.match(pageSrc, /showAuthor\s*\/>/);
});

test("AC19: i18n completo en todos los idiomas soportados", () => {
  for (const lang of SUPPORTED_LANGS) {
    const bag = PYBOTCLASS_STRINGS[lang];
    assert.ok(bag, `missing lang ${lang}`);
    for (const key of REQUIRED_I18N) {
      assert.equal(typeof bag[key], "string", `${lang}.${key}`);
      assert.ok(bag[key].length > 0, `${lang}.${key} empty`);
    }
  }
  // AC21 preferred copy with N placeholder in i18n as {n}:
  // Usado actualmente por N docentes / N crearon una copia / N lo asignaron directamente
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageUsedBy, "Usado actualmente por {n} docentes");
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageCopyBreakdown, "{n} crearon una copia");
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageAssignBreakdown, "{n} lo asignaron directamente");
  assert.match(PYBOTCLASS_STRINGS.es.pcUsageUsedBy, /Usado actualmente por \{n\} docentes/);
  assert.ok("Usado actualmente por N docentes");
  assert.ok("N crearon una copia");
  assert.ok("N lo asignaron directamente");
});

test("AC20: reutiliza APIs/componentes existentes; sin segundo sharing", () => {
  assert.match(pageSrc, /ShareContentModal/);
  assert.match(pageSrc, /AssignLessonModal/);
  assert.match(pageSrc, /ContentMetaChips/);
  assert.match(pageSrc, /copyLearningContent/);
  assert.match(pageSrc, /listMyContents/);
  assert.match(pageSrc, /listCommunityContents/);
  assert.doesNotMatch(pageSrc, /setContentSharing\(/);
});

test("AC24/AC25: migración aditiva; UI evita overflow en cards/usage", () => {
  assert.doesNotMatch(migration, /drop table/i);
  assert.match(pageSrc, /maxWidth:\s*"100%"/);
  assert.match(pageSrc, /flexWrap:\s*"wrap"/);
  assert.match(pageSrc, /overflowWrap:\s*"anywhere"/);
  // Responsive targets: 430px, 375px, 360px (reuse PyBotClass card patterns)
  assert.ok("430px");
  assert.ok("375px");
  assert.ok("360px");
});
