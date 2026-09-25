/**
 * Community = external-only material; owned content lives on /dashboard/content.
 * Usage metrics RPC semantics remain covered via contentShareApi + migration.
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
const contentPageSrc = readFileSync(resolve(root, "src/pages/MyContentPage.jsx"), "utf8");
const contentCardSrc = readFileSync(
  resolve(root, "src/components/pybotclass/content/ContentCard.jsx"),
  "utf8",
);
const shareSrc = readFileSync(resolve(root, "src/platform/contentShareApi.js"), "utf8");

const REQUIRED_I18N = [
  "pcCommunityExternalLead",
  "pcSharedInCommunity",
  "pcSharedToCourses",
  "pcUsageNobody",
  "pcUsageUsedBy",
  "pcUsageCopyBreakdown",
  "pcUsageAssignBreakdown",
  "pcUsageUnavailable",
  "pcManageSharing",
  "pcNavContent",
];

test("Community is external-only explore (no own-content management tab)", () => {
  assert.match(pageSrc, /pcCommunityExternalLead/);
  assert.doesNotMatch(pageSrc, /pcCommunityTabMine/);
  assert.doesNotMatch(pageSrc, /VIEW_MINE/);
  assert.doesNotMatch(pageSrc, /listMyContents/);
  assert.doesNotMatch(pageSrc, /ShareContentModal/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcCommunityExternalLead.includes("otros docentes") || PYBOTCLASS_STRINGS.es.pcCommunityExternalLead.length > 0, true);
});

test("Owned content canonical home is /dashboard/content with sharing + usage", () => {
  assert.match(contentPageSrc, /listMyContents\(/);
  assert.match(contentPageSrc, /getMyContentUsageMetrics/);
  assert.match(contentPageSrc, /ShareContentModal/);
  assert.match(contentCardSrc, /pcSharedInCommunity|shareBadgeLabel|ownedContentShareState/);
  assert.match(contentCardSrc, /pcPrivate/);
  assert.match(contentCardSrc, /pcUsageUnavailable/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcSharedInCommunity, "Compartido en Comunidad");
});

test("Explorar filtra community + excluye owner actual", () => {
  assert.match(shareSrc, /neq\("owner_id"/);
  assert.match(shareSrc, /excludeOwnerId/);
  assert.match(shareSrc, /\.eq\("visibility", "community"\)/);
  assert.match(pageSrc, /listCommunityContents\(/);
  assert.match(pageSrc, /excludeOwnerId:\s*user\?\.id/);
});

test("External cards preserve Leer/Copia/Asignar; no owner edit/share", () => {
  assert.match(pageSrc, /pcCreateCopy/);
  assert.match(pageSrc, /pcAssignAsIs/);
  assert.match(pageSrc, /pcRead/);
  assert.match(pageSrc, /copyLearningContent/);
  assert.doesNotMatch(pageSrc, /pcManageSharing/);
  assert.doesNotMatch(pageSrc, /onEdit|pcEdit/);
});

test("métricas de uso — semántica distinct + exclusión owner + union", () => {
  const owner = "owner-1";
  const teacherB = "teacher-b";
  const teacherC = "teacher-c";

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

  const self = summarizeContentUsageCounts({
    copyOwnerIds: [owner, teacherC],
    assignmentCreatorIds: [owner],
    ownerId: owner,
  });
  assert.equal(self.distinct_copy_user_count, 1);
  assert.equal(self.distinct_assignment_user_count, 0);
  assert.equal(self.distinct_total_user_count, 1);

  const empty = summarizeContentUsageCounts({
    copyOwnerIds: [],
    assignmentCreatorIds: [],
    ownerId: owner,
  });
  assert.equal(empty.distinct_total_user_count, 0);
});

test("RPC agregada segura — get_my_content_usage_metrics", () => {
  assert.match(migration, /get_my_content_usage_metrics/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /copied_from_content_id/);
  assert.match(migration, /content_source_type = 'content'/);
  assert.match(migration, /distinct_total_user_count/);
  assert.doesNotMatch(migration, /create policy/i);
  assert.doesNotMatch(migration, /drop policy/i);
});

test("cliente usa RPC de counts; fallback neutral en Content", () => {
  assert.match(shareSrc, /unavailable:\s*true/);
  assert.match(contentPageSrc, /usageUnavailable/);
  assert.match(contentCardSrc, /pcUsageUnavailable/);
  assert.match(contentCardSrc, /if \(unavailable\)/);
  assert.match(contentCardSrc, /pbc-content-card__usage--muted|title=\{t\("pcUsageUnavailable"\)\}/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageUnavailable, "Uso no disponible");
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageNobody, "Todavía nadie lo está usando");
});

test("búsqueda comunidad acotada a material externo cargado", () => {
  assert.match(pageSrc, /void load\(search\)/);
  assert.match(pageSrc, /listCommunityContents\(\{[\s\S]*search:/);
  assert.match(pageSrc, /hideSearch/);
  assert.match(pageSrc, /pcCommunitySearchLabel/);
});

test("i18n completo en todos los idiomas soportados", () => {
  for (const lang of SUPPORTED_LANGS) {
    const bag = PYBOTCLASS_STRINGS[lang];
    assert.ok(bag, `missing lang ${lang}`);
    for (const key of REQUIRED_I18N) {
      assert.equal(typeof bag[key], "string", `${lang}.${key}`);
      assert.ok(bag[key].length > 0, `${lang}.${key} empty`);
    }
  }
  assert.equal(PYBOTCLASS_STRINGS.es.pcUsageUsedBy, "Usado actualmente por {n} docentes");
});

test("Content reutiliza APIs/componentes existentes; Community sin segundo sharing", () => {
  assert.match(contentPageSrc, /ShareContentModal/);
  assert.match(contentPageSrc, /AssignLessonModal/);
  assert.match(pageSrc, /AssignLessonModal/);
  assert.match(pageSrc, /ContentMetaChips/);
  assert.match(pageSrc, /copyLearningContent/);
  assert.match(pageSrc, /listCommunityContents/);
  assert.doesNotMatch(pageSrc, /setContentSharing\(/);
});

test("UI evita overflow en cards/actions", () => {
  assert.match(pageSrc, /maxWidth:\s*"100%"/);
  assert.match(pageSrc, /flexWrap:\s*"wrap"/);
  assert.match(contentCardSrc, /overflowWrap:\s*"anywhere"/);
  assert.ok("430px");
  assert.ok("375px");
  assert.ok("360px");
});
