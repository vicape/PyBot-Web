SETUP Supabase para PyBot Web (plataforma / colegios)
====================================================

1) Crear proyecto en https://supabase.com y anotar Project URL + anon public key.

2) En el SQL Editor del proyecto, ejecutar el archivo:
   supabase/migrations/20260216000001_init_platform.sql
   (Una sola vez por proyecto.)

3) Authentication > Providers > Google: activar y pegar Client ID y Client Secret del mismo
   proyecto de Google Cloud (o uno dedicado). En Google Cloud Console > Credenciales OAuth,
   en "URIs de redireccionamiento autorizados" debe figurar:
     https://TU_REF.supabase.co/auth/v1/callback
   (El valor exacto está en Supabase > Authentication > Providers > Google.)

4) Authentication > URL Configuration:
   Site URL: tu app de producción, ej. https://pybot-web.vercel.app
   Additional Redirect URLs:
     http://localhost:5173/auth/callback
     https://pybot-web.vercel.app/auth/callback
   (Sumá tu dominio custom si existe.)

5) En .env local y en Vercel (Production):
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   Redeploy después de agregar variables.

6) Si configurás Supabase, el login en /login usa OAuth de Supabase (Google) y el panel
   puede crear colegios en la base.
   Si solo tenés VITE_GOOGLE_CLIENT_ID, sigue el modo anterior (perfil en el navegador).
