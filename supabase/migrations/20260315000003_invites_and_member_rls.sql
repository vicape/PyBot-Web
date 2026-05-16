-- Invitaciones alumno/docente + endurecimiento de inserts en organization_members.
-- Ejecutá después de 20260216000001 y 20260217000002.

-- --- Quitar política laxa autoinserción ---------------------------------------

drop policy if exists om_insert_self on public.organization_members;

-- Primer miembro: solo el creador del colegio puede agregarse como owner (sin filas previas).
create policy om_insert_creator_owner on public.organization_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1
      from public.organizations o
      where o.id = organization_members.org_id
        and o.created_by = auth.uid()
    )
    and not exists (
      select 1
      from public.organization_members om2
      where om2.org_id = organization_members.org_id
    )
  );

-- Owner/teacher puede agregar a otras cuentas (alta manual); el alta vía invitación usa RPC security definer.
create policy om_staff_adds_other_members on public.organization_members
  for insert to authenticated
  with check (
    user_id <> auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.org_id = organization_members.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );

-- --- Invitaciones con código -------------------------------------------------

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null default lower(substring(replace(gen_random_uuid()::text, '-', ''), 1, 14)),
  role text not null check (role in ('teacher', 'student')),
  expires_at timestamptz,
  max_uses int not null default 1 check (max_uses >= 1),
  use_count int not null default 0 check (use_count >= 0),
  created_by uuid not null references auth.users (id),
  created_at timestamptz default now(),
  unique (code)
);

create index if not exists organization_invites_org_id_idx on public.organization_invites (org_id);

alter table public.organization_invites enable row level security;

create policy oi_select_staff on public.organization_invites
  for select using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = organization_invites.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );

create policy oi_insert_staff on public.organization_invites
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.org_id = organization_invites.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );

create policy oi_delete_staff on public.organization_invites
  for delete using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = organization_invites.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );

create or replace function public.redeem_org_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
  key text := lower(trim(coalesce(invite_code, '')));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if key = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_code');
  end if;

  select * into inv from public.organization_invites where code = key for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if inv.expires_at is not null and inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if inv.use_count >= inv.max_uses then
    return jsonb_build_object('ok', false, 'error', 'max_uses');
  end if;

  if exists (
    select 1
    from public.organization_members om
    where om.org_id = inv.org_id
      and om.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  insert into public.organization_members (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role);

  update public.organization_invites
  set use_count = use_count + 1
  where id = inv.id;

  return jsonb_build_object('ok', true, 'org_id', inv.org_id, 'role', inv.role);
end;
$$;

grant execute on function public.redeem_org_invite(text) to authenticated;

-- --- Docentes: actualizar curso para enlazar classroom_course_id ------------

drop policy if exists courses_update_staff on public.courses;

create policy courses_update_staff on public.courses
  for update to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = courses.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = courses.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );
