-- Vincula un curso PyBot con el curso de Google Classroom correspondiente.
alter table public.courses
  add column if not exists classroom_course_id text;

create index if not exists courses_classroom_id_idx on public.courses (classroom_course_id);
