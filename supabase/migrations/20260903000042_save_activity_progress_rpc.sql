-- Migración 042 — Guardar activity_progress vía RPC (evita fallos de UPSERT+RLS)
-- IDEMPOTENTE.

create or replace function public.save_activity_progress(
  p_activity_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if p_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_activity_id');
  end if;

  if not public.activity_visible_to_me(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.activity_progress (activity_id, user_id, code, updated_at)
  values (p_activity_id, v_uid, coalesce(p_code, ''), now())
  on conflict (activity_id, user_id) do update
  set
    code = excluded.code,
    updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.save_activity_progress(uuid, text) to authenticated;
