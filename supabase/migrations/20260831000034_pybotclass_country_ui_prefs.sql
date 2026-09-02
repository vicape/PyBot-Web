-- PyBotClass: país en instituciones + preferencias de apariencia en perfiles
-- Aditivo: no rompe registros existentes.

alter table public.organizations
  add column if not exists country_code text;

alter table public.profiles
  add column if not exists ui_theme text,
  add column if not exists ui_background text,
  add column if not exists ui_background_color text;

comment on column public.organizations.country_code is 'ISO 3166-1 alpha-2 (nullable para instituciones históricas)';
comment on column public.profiles.ui_theme is 'system | light | dark';
comment on column public.profiles.ui_background is 'default | clean | deep-blue | indigo | graphite | custom';
comment on column public.profiles.ui_background_color is 'Hex #RRGGBB cuando ui_background = custom';

-- Crear institución con owner + país (v2 compatible)
create or replace function public.create_organization_with_owner_v2(
  p_name text,
  p_slug text,
  p_country_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_org_id uuid;
  v_attempt int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_name');
  end if;
  if v_country = '' or length(v_country) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_country');
  end if;
  if v_slug = '' then
    v_slug := 'inst-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  while v_attempt < 8 loop
    begin
      insert into public.organizations (name, slug, created_by, country_code)
      values (v_name, v_slug, v_uid, v_country)
      returning id into v_org_id;
      exit;
    exception when unique_violation then
      v_slug := v_slug || '-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      v_attempt := v_attempt + 1;
    end;
  end loop;

  if v_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'slug_taken');
  end if;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org_id, v_uid, 'owner')
  on conflict (org_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'org_id', v_org_id, 'slug', v_slug, 'country_code', v_country);
end;
$$;

grant execute on function public.create_organization_with_owner_v2(text, text, text) to authenticated;

-- Asegurar permiso docente mínimo al crear curso en institución existente
create or replace function public.ensure_org_teacher_access(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if p_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_org');
  end if;

  select role into v_role
  from public.organization_members
  where org_id = p_org_id and user_id = v_uid;

  if v_role = 'owner' or v_role = 'teacher' then
    return jsonb_build_object('ok', true, 'role', v_role);
  end if;

  insert into public.organization_members (org_id, user_id, role)
  values (p_org_id, v_uid, 'teacher')
  on conflict (org_id, user_id) do update
    set role = case
      when public.organization_members.role = 'owner' then 'owner'
      else 'teacher'
    end;

  return jsonb_build_object('ok', true, 'role', 'teacher');
end;
$$;

grant execute on function public.ensure_org_teacher_access(uuid) to authenticated;
