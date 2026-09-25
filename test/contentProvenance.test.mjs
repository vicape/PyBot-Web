import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pickContentMetadata } from "../src/platform/contentMetadata.js";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";
import { SUPPORTED_LANGS } from "../src/i18n.js";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20260925100049_learning_content_creator_community_provenance.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const chipsSrc = readFileSync(
  resolve(root, "src/components/pybotclass/content/ContentMetaChips.jsx"),
  "utf8",
);
const metaSrc = readFileSync(resolve(root, "src/platform/contentMetadata.js"), "utf8");
const shareSrc = readFileSync(resolve(root, "src/platform/contentShareApi.js"), "utf8");
const apiSrc = readFileSync(resolve(root, "src/platform/contentApi.js"), "utf8");

test("migración provenance: columnas aditivas y FKs ON DELETE SET NULL", () => {
  assert.match(migration, /original_creator_id/);
  assert.match(migration, /first_community_published_by_id/);
  assert.match(migration, /first_community_published_at/);
  assert.match(migration, /add column if not exists original_creator_id/);
  assert.match(migration, /add column if not exists first_community_published_by_id/);
  assert.match(migration, /add column if not exists first_community_published_at/);
  assert.match(migration, /on delete set null/i);
  assert.doesNotMatch(migration, /on delete cascade/i);
  assert.doesNotMatch(migration, /drop table public\.learning_contents/i);
  assert.doesNotMatch(migration, /drop column/i);
});

test("AC1: contenido original persiste original_creator_id = auth.uid() en INSERT", () => {
  assert.match(migration, /tg_op = 'INSERT'/);
  assert.match(migration, /new\.original_creator_id := auth\.uid\(\)/);
  assert.match(migration, /new\.first_community_published_by_id := null/);
  assert.match(migration, /new\.first_community_published_at := null/);
});

test("AC2/AC5/AC11: copy RPC hereda creator + first community y nuevo owner es el copista", () => {
  assert.match(migration, /create or replace function public\.copy_learning_content/);
  assert.match(migration, /original_creator_id,/);
  assert.match(migration, /first_community_published_by_id,/);
  assert.match(migration, /first_community_published_at/);
  assert.match(migration, /v_root_creator/);
  assert.match(migration, /v_first_by/);
  assert.match(migration, /v_uid,/); // new owner
  assert.match(migration, /v_root_id,/); // original_content_id
  assert.match(migration, /v_src\.id,/); // copied_from
  // copy-of-copy: root from coalesce(original_content_id, id)
  assert.match(migration, /coalesce\(v_src\.original_content_id, v_src\.id\)/);
  // creator never replaced by copy owner
  assert.match(
    migration,
    /coalesce\(v_src\.original_creator_id, v_src\.original_owner_id, v_src\.owner_id\)/,
  );
});

test("AC3/AC4: primera transición a community captura publisher; re-publish no sobrescribe", () => {
  assert.match(migration, /new\.visibility = 'community'/);
  assert.match(migration, /old\.visibility is distinct from 'community'/);
  assert.match(migration, /new\.first_community_published_by_id := auth\.uid\(\)/);
  assert.match(migration, /new\.first_community_published_at := now\(\)/);
  // immutable once set
  assert.match(migration, /if old\.first_community_published_by_id is not null then/);
  assert.match(
    migration,
    /new\.first_community_published_by_id := old\.first_community_published_by_id/,
  );
  assert.match(
    migration,
    /new\.first_community_published_at := old\.first_community_published_at/,
  );
});

test("AC8: legacy first-community NO se inventa (sin backfill de publisher)", () => {
  // original_creator backfill exists
  assert.match(
    migration,
    /set original_creator_id = original_owner_id[\s\S]*original_creator_id is null/,
  );
  assert.match(
    migration,
    /set original_creator_id = owner_id[\s\S]*copied_from_content_id is null/,
  );
  // first_community must NOT be backfilled from owner/visibility/updated_at/created_at
  assert.doesNotMatch(
    migration,
    /set\s+first_community_published_by_id\s*=\s*owner_id/i,
  );
  assert.doesNotMatch(
    migration,
    /set\s+first_community_published_at\s*=\s*(created_at|updated_at)/i,
  );
  assert.match(migration, /intentionally NOT backfilled|NOT backfilled/i);
});

test("AC10: anti-forgery — cliente no puede forjar provenance en insert/update ordinario", () => {
  assert.match(migration, /learning_contents_guard_provenance/);
  assert.match(migration, /pybot\.copying_content/);
  // strip lineage on client insert
  assert.match(migration, /new\.copied_from_content_id := null/);
  assert.match(migration, /new\.original_content_id := null/);
  assert.match(migration, /new\.original_owner_id := null/);
  // preserve on update
  assert.match(migration, /new\.copied_from_content_id := old\.copied_from_content_id/);
  assert.match(migration, /new\.original_creator_id := old\.original_creator_id/);
  // setContentSharing only updates visibility (trusted path is trigger)
  assert.match(shareSrc, /update\(\{ visibility: vis/);
  assert.doesNotMatch(shareSrc, /first_community_published_by_id:/);
  assert.doesNotMatch(shareSrc, /original_creator_id:/);
  // createContent does not send forgeable provenance fields
  assert.match(apiSrc, /insert\(\{[\s\S]*owner_id: userId/);
  assert.doesNotMatch(apiSrc, /insert\(\{[\s\S]*original_creator_id:/);
});

test("AC6: owner_id permanece independiente en metadata/API", () => {
  assert.match(metaSrc, /original_creator_id/);
  assert.match(metaSrc, /first_community_published_by_id/);
  assert.match(metaSrc, /first_community_published_at/);
  const picked = pickContentMetadata({
    owner_id: "owner-1",
    original_creator_id: "creator-1",
    first_community_published_by_id: "pub-1",
    first_community_published_at: "2026-09-12T00:00:00Z",
    original_owner_id: "orig-owner",
    language_code: "es",
  });
  assert.equal(picked.original_creator_id, "creator-1");
  assert.equal(picked.first_community_published_by_id, "pub-1");
  assert.equal(picked.original_owner_id, "orig-owner");
  assert.equal(picked.language_code, "es");
});

test("AC7: UI labels explícitas (creador / compartido / propietario actual)", () => {
  assert.match(chipsSrc, /pcOriginallyCreatedBy/);
  assert.match(chipsSrc, /pcOriginallySharedInPyBotBy/);
  assert.match(chipsSrc, /pcOriginallySharedInPyBotUnknown/);
  assert.match(chipsSrc, /pcOwner/);
  assert.doesNotMatch(chipsSrc, /pcOriginalOf/);
  assert.match(chipsSrc, /first_community_published_by_id/);
  assert.match(chipsSrc, /overflowWrap:\s*"anywhere"/);
  assert.match(chipsSrc, /maxWidth:\s*"100%"/);

  assert.equal(PYBOTCLASS_STRINGS.es.pcOriginallyCreatedBy, "Creado originalmente por:");
  assert.equal(
    PYBOTCLASS_STRINGS.es.pcOriginallySharedInPyBotBy,
    "Compartido originalmente en PyBot por:",
  );
  assert.equal(
    PYBOTCLASS_STRINGS.es.pcOriginallySharedInPyBotUnknown,
    "Compartido originalmente en PyBot: dato histórico no disponible",
  );
  assert.equal(PYBOTCLASS_STRINGS.es.pcOwner, "Propietario actual:");
});

test("i18n: claves de provenance en todos los idiomas soportados", () => {
  const keys = [
    "pcOriginallyCreatedBy",
    "pcOriginallySharedInPyBotBy",
    "pcOriginallySharedInPyBotUnknown",
    "pcOwner",
  ];
  for (const lang of SUPPORTED_LANGS) {
    for (const key of keys) {
      assert.equal(typeof PYBOTCLASS_STRINGS[lang][key], "string", `${lang}.${key}`);
      assert.ok(PYBOTCLASS_STRINGS[lang][key].length > 0, `${lang}.${key}`);
    }
  }
});

test("lineage: publish de copia propaga first-community al root sin sobrescribir si ya existe", () => {
  assert.match(migration, /learning_contents_propagate_lineage_first_community/);
  assert.match(migration, /pybot\.propagating_lineage_provenance/);
  assert.match(migration, /and first_community_published_by_id is null/);
  assert.match(migration, /coalesce\(old\.original_content_id, new\.id\)/);
});

test("permisos owner-only no se debilitan en la migración de provenance", () => {
  assert.doesNotMatch(migration, /create policy learning_contents_update/i);
  assert.doesNotMatch(migration, /create policy learning_contents_delete/i);
  assert.doesNotMatch(migration, /create policy learning_contents_insert/i);
});
