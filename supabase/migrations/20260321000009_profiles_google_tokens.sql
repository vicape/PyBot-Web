-- Guardar tokens de Google Classroom para renovación automática.
-- El refresh_token permite pedir nuevos access_tokens sin que el usuario tenga que reconectar.

alter table public.profiles
  add column if not exists google_refresh_token text,
  add column if not exists google_token_expires_at timestamptz;

-- Solo el propio usuario puede leer/escribir sus tokens (RLS ya cubre esto via profiles_select_own)
-- No se necesita política extra: las existentes en profiles ya restringen a id = auth.uid()
