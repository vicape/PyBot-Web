-- PyBot Web: multi-tenant MVP (ejecutá en SQL Editor del proyecto Supabase).
-- Activá Google OAuth en Authentication > Providers (mismo proyecto Google Cloud opcional pero recomendado).

-- --- Perfil (mirror de auth.users) ------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- Organización (colegio) --------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz default now()
);

alter table public.organizations enable row level security;

create policy org_select_member on public.organizations
  for select using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
    )
  );

create policy org_insert_creator on public.organizations
  for insert to authenticated
  with check (created_by = auth.uid());

-- --- Membresía -----------------------------------------------------------

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'teacher', 'student')),
  created_at timestamptz default now(),
  primary key (org_id, user_id)
);

alter table public.organization_members enable row level security;

create policy om_select_my_orgs on public.organization_members
  for select using (
    org_id in (
      select org_id from public.organization_members where user_id = auth.uid()
    )
  );

create policy om_insert_self on public.organization_members
  for insert to authenticated
  with check (user_id = auth.uid());
