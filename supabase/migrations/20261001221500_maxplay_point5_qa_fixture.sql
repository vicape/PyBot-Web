-- MaxPlay Point 5 QA fixture (forward-only, idempotent).
-- Targets ONLY:
--   user_id  = 61675287-117c-4c1b-b025-b97fe6aa358b (test@spaceclub.com.ar)
--   course_id = 9ad57da1-675d-4c26-93d6-62e149a5276e (MAXPLAY QA 20260923112332)
-- Does NOT mutate non-QA rows. Does NOT change RLS.
-- Fail closed if the fixed QA user or course are missing.

do $fixture$
declare
  v_qa_user_id   uuid := '61675287-117c-4c1b-b025-b97fe6aa358b';
  v_qa_course_id uuid := '9ad57da1-675d-4c26-93d6-62e149a5276e';
  v_qa_email     text := 'test@spaceclub.com.ar';
  v_qa_course_title text := 'MAXPLAY QA 20260923112332';

  -- Deterministic QA-only UUIDs (fixture records only; not live content rows).
  v_activity_id  uuid := 'a5e05f15-9015-4f05-b015-0000000000a1';
  v_source_id    uuid := 'a5e05f15-9015-4f05-b015-0000000000a2';
  v_unit_id      uuid := 'a5e05f15-9015-4f05-b015-0000000000a3';
  v_material_id  uuid := 'a5e05f15-9015-4f05-b015-0000000000a4';
  v_video_id     uuid := 'a5e05f15-9015-4f05-b015-0000000000a5';

  v_prefix       text := 'MAXPLAY QA POINT5';
  v_activity_title text := 'MAXPLAY QA POINT5 browser validation';
  v_snapshot     jsonb;
  v_user_email   text;
  v_course_title text;
begin
  -- Fail closed: QA user must exist (auth.users).
  select u.email into v_user_email
  from auth.users u
  where u.id = v_qa_user_id;

  if v_user_email is null then
    raise exception
      'MAXPLAY QA POINT5 fixture: QA user % does not exist',
      v_qa_user_id;
  end if;

  if lower(trim(v_user_email)) is distinct from lower(v_qa_email) then
    raise exception
      'MAXPLAY QA POINT5 fixture: QA user % email mismatch (expected %, found %)',
      v_qa_user_id, v_qa_email, v_user_email;
  end if;

  -- Fail closed: QA course must exist with expected title.
  select c.title into v_course_title
  from public.courses c
  where c.id = v_qa_course_id;

  if v_course_title is null then
    raise exception
      'MAXPLAY QA POINT5 fixture: QA course % does not exist',
      v_qa_course_id;
  end if;

  if v_course_title is distinct from v_qa_course_title then
    raise exception
      'MAXPLAY QA POINT5 fixture: QA course % title mismatch (expected %, found %)',
      v_qa_course_id, v_qa_course_title, v_course_title;
  end if;

  -- Ensure factual course_members.role = 'student' without duplicate insertion.
  insert into public.course_members (course_id, user_id, role, source)
  values (v_qa_course_id, v_qa_user_id, 'student', 'manual')
  on conflict (course_id, user_id) do update
    set role = 'student'
  where public.course_members.role is distinct from 'student';

  -- Exactly one QA Point 5 activity: refuse a different-id duplicate under the same prefix.
  if exists (
    select 1
    from public.activities a
    where a.course_id = v_qa_course_id
      and a.title like v_prefix || '%'
      and a.id is distinct from v_activity_id
  ) then
    raise exception
      'MAXPLAY QA POINT5 fixture: another activity with prefix "%" already exists in QA course %',
      v_prefix, v_qa_course_id;
  end if;

  -- Snapshot shape consumed by AssignedContentSnapshotViewer (sourceType=lesson + items).
  -- content_lesson_id left null (no live content_lessons FK). content_source_id is snapshot-only.
  v_snapshot := jsonb_build_object(
    'schemaVersion', 3,
    'sourceType', 'lesson',
    'sourceId', v_source_id,
    'title', v_prefix || ' lesson',
    'description', 'QA fixture for Point 5 browser validation (student engagement).',
    'itemType', 'lesson',
    'estimatedMinutes', 5,
    'mediaOwnerId', v_qa_user_id,
    'contentId', null,
    'contentTitle', v_prefix || ' content',
    'unitId', v_unit_id,
    'unitTitle', v_prefix || ' unit',
    'unitType', 'unit',
    'document_json', jsonb_build_array(
      jsonb_build_object(
        'id', 'a5e05f15-9015-4f05-b015-0000000000b1',
        'type', 'paragraph',
        'props', jsonb_build_object(
          'textColor', 'default',
          'backgroundColor', 'default',
          'textAlignment', 'left'
        ),
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'text',
            'text', 'MAXPLAY QA POINT5 lesson body for assigned-content snapshot validation.',
            'styles', '{}'::jsonb
          )
        ),
        'children', '[]'::jsonb
      )
    ),
    'items', jsonb_build_array(
      jsonb_build_object(
        'snapshotItemId', v_material_id,
        'sourceItemId', v_material_id,
        'type', 'material',
        'title', v_prefix || ' material',
        'position', 0,
        'content', jsonb_build_object(
          'document_json', jsonb_build_array(
            jsonb_build_object(
              'id', 'a5e05f15-9015-4f05-b015-0000000000b2',
              'type', 'paragraph',
              'props', jsonb_build_object(
                'textColor', 'default',
                'backgroundColor', 'default',
                'textAlignment', 'left'
              ),
              'content', jsonb_build_array(
                jsonb_build_object(
                  'type', 'text',
                  'text', 'MAXPLAY QA POINT5 non-video material item.',
                  'styles', '{}'::jsonb
                )
              ),
              'children', '[]'::jsonb
            )
          ),
          'document_version', 1
        ),
        'config', jsonb_build_object(
          'required', true,
          'completion_rule', 'marked_complete'
        )
      ),
      jsonb_build_object(
        'snapshotItemId', v_video_id,
        'sourceItemId', v_video_id,
        'type', 'video',
        'title', v_prefix || ' video',
        'position', 1,
        'content', jsonb_build_object(
          'url', 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
        ),
        'config', jsonb_build_object(
          'required', true,
          'completion_rule', 'video_threshold',
          'completion_threshold', 1
        )
      )
    )
  );

  insert into public.activities (
    id,
    course_id,
    title,
    description,
    starter_code,
    created_by,
    origin,
    content_snapshot,
    content_source_type,
    content_source_id,
    activity_kind,
    content_lesson_id
  )
  values (
    v_activity_id,
    v_qa_course_id,
    v_activity_title,
    'QA fixture activity for MaxPlay Point 5 student browser validation.',
    '',
    v_qa_user_id,
    'pybot',
    v_snapshot,
    'lesson',
    v_source_id,
    'material',
    null
  )
  on conflict (id) do nothing;
end;
$fixture$;
