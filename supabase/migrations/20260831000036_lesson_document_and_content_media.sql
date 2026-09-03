-- Editor de lecciones BlockNote: documento JSON + bucket privado de media.
-- No modifica ni borra lesson_blocks.

alter table public.content_lessons
  add column if not exists document_json jsonb,
  add column if not exists document_version integer not null default 1;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-media',
  'content-media',
  false,
  104857600,
  array[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/webm',
    'video/mp4',
    'video/webm',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

drop policy if exists content_media_select_own on storage.objects;
create policy content_media_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'content-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists content_media_insert_own on storage.objects;
create policy content_media_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'content-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists content_media_update_own on storage.objects;
create policy content_media_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'content-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'content-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists content_media_delete_own on storage.objects;
create policy content_media_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'content-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
