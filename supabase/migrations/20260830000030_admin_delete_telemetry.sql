-- Migración 030 — Super admin: borrar telemetría (sesiones/eventos)
-- IDEMPOTENTE.
-- NO cambia captura de IP, cookies ni estructura de usage_sessions.

create or replace function public.admin_delete_usage_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_session_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_id');
  end if;

  delete from public.usage_sessions where id = p_session_id;

  return jsonb_build_object('ok', true, 'deleted', 1);
end;
$$;

grant execute on function public.admin_delete_usage_session(uuid) to authenticated;

create or replace function public.admin_delete_user_telemetry(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_id');
  end if;

  delete from public.usage_sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted', v_count);
end;
$$;

grant execute on function public.admin_delete_user_telemetry(uuid) to authenticated;
