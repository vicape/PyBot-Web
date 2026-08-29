-- ──────────────────────────────────────────────────────────────────────────
-- Migración 015 — Invitaciones específicas a curso (organization_invites.course_id).
-- IDEMPOTENTE. No modifica migraciones anteriores.
-- ──────────────────────────────────────────────────────────────────────────

-- 1) Columna course_id (nullable: invitaciones generales de colegio) ─────────

alter table public.organization_invites
  add column if not exists course_id uuid references public.courses (id) on delete cascade;

create index if not exists organization_invites_course_id_idx
  on public.organization_invites (course_id)
  where course_id is not null;

-- 2) INSERT policy: org invite o course invite con validación ────────────────

drop policy if exists oi_insert_staff on public.organization_invites;

create policy oi_insert_staff on public.organization_invites
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_org_staff(org_id)
    and (
      course_id is null
      or (
        public.is_course_org_staff(course_id)
        and exists (
          select 1
          from public.courses c
          where c.id = course_id
            and c.org_id = organization_invites.org_id
        )
      )
    )
  );

-- 3) redeem_org_invite: colegio vs curso ────────────────────────────────────

create or replace function public.redeem_org_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
  key text := lower(trim(coalesce(invite_code, '')));
  v_course_org uuid;
  v_already_org boolean;
  v_cm_role text;
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

  -- ── Invitación de curso ──────────────────────────────────────────────────
  if inv.course_id is not null then
    select c.org_id into v_course_org
    from public.courses c
    where c.id = inv.course_id;

    if v_course_org is null then
      return jsonb_build_object('ok', false, 'error', 'curso_invalido');
    end if;

    if v_course_org <> inv.org_id then
      return jsonb_build_object('ok', false, 'error', 'curso_invalido');
    end if;

    select exists (
      select 1
      from public.organization_members om
      where om.org_id = inv.org_id
        and om.user_id = auth.uid()
    ) into v_already_org;

    if not v_already_org then
      insert into public.organization_members (org_id, user_id, role)
      values (inv.org_id, auth.uid(), inv.role);
    end if;

    -- course_members.role solo admite teacher|student (igual que invites)
    v_cm_role := case
      when inv.role in ('teacher', 'student') then inv.role
      else 'student'
    end;

    insert into public.course_members (
      course_id,
      user_id,
      role,
      source
    )
    values (
      inv.course_id,
      auth.uid(),
      v_cm_role,
      'invite'
    )
    on conflict (course_id, user_id) do update
    set
      role = excluded.role,
      source = excluded.source;

    update public.organization_invites
    set use_count = use_count + 1
    where id = inv.id;

    return jsonb_build_object(
      'ok', true,
      'org_id', inv.org_id,
      'course_id', inv.course_id,
      'role', inv.role
    );
  end if;

  -- ── Invitación solo de colegio (comportamiento histórico) ────────────────
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

  return jsonb_build_object(
    'ok', true,
    'org_id', inv.org_id,
    'course_id', null,
    'role', inv.role
  );
end;
$$;

grant execute on function public.redeem_org_invite(text) to authenticated;
