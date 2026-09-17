/**
 * Strings de la puerta de entrada (landing / login).
 * Extensible: el resto de PyBot puede sumar claves aquí o en locales propios.
 */
export const SUPPORTED_LANGS = ["es", "en", "fr", "pt"];

export const LANG_LABELS = {
  es: "Español",
  en: "English",
  fr: "Français",
  pt: "Português",
};

export const ENTRY_STRINGS = {
  es: {
    entryBrand: "PyBot",
    entryTagline: "Tecnología · Educación",
    entryTitle: "Programá, aprendé y enseñá con Python",
    entryLead:
      "Un entorno moderno para aprender programación con Python, bloques, pseudocódigo, diagramas, hardware y gestión de clases.",
    entryCapPython: "Python",
    entryCapBlocks: "Bloques",
    entryCapHardware: "Hardware",
    entryCapClasses: "Clases",
    entryGoogleContinue: "Continuar con Google",
    entryGoogleSignIn: "Iniciar sesión con Google",
    entryGoogleLoading: "Conectando con Google…",
    entryGoogleDisabled: "Google no disponible",
    entryLanguage: "Idioma",
    entryIdeLink: "Abrir IDE sin cuenta",
    entryDashboardLink: "Ir al panel",
    entrySessionNotice:
      "Ya hay una sesión guardada en este navegador. Podés ir al panel o cerrar sesión allí.",
    entryClassroomHint:
      "Google Classroom se conecta después, cuando elijas importar cursos.",
    entryLeadSupabase: "Una cuenta por email. Entrá con Google para usar PyBot.",
    entryLeadGis: "Iniciá sesión con tu cuenta de Google.",
    entryLeadStub: "Configurá el inicio de sesión con Google para esta instalación.",
    entryStubHint:
      "Copiá .env.example a .env y definí VITE_GOOGLE_CLIENT_ID o Supabase (VITE_SUPABASE_*). Reiniciá el servidor de desarrollo.",
  },
  en: {
    entryBrand: "PyBot",
    entryTagline: "Technology · Education",
    entryTitle: "Code, learn, and teach with Python",
    entryLead:
      "A modern environment to learn programming with Python, blocks, pseudocode, diagrams, hardware, and class management.",
    entryCapPython: "Python",
    entryCapBlocks: "Blocks",
    entryCapHardware: "Hardware",
    entryCapClasses: "Classes",
    entryGoogleContinue: "Continue with Google",
    entryGoogleSignIn: "Sign in with Google",
    entryGoogleLoading: "Connecting to Google…",
    entryGoogleDisabled: "Google unavailable",
    entryLanguage: "Language",
    entryIdeLink: "Open IDE without an account",
    entryDashboardLink: "Go to dashboard",
    entrySessionNotice:
      "A session is already saved in this browser. You can open the dashboard or sign out there.",
    entryClassroomHint: "Google Classroom connects later, when you import courses.",
    entryLeadSupabase: "One account per email. Sign in with Google to use PyBot.",
    entryLeadGis: "Sign in with your Google account.",
    entryLeadStub: "Configure Google sign-in for this installation.",
    entryStubHint:
      "Copy .env.example to .env and set VITE_GOOGLE_CLIENT_ID or Supabase (VITE_SUPABASE_*). Restart the dev server.",
  },
  fr: {
    entryBrand: "PyBot",
    entryTagline: "Technologie · Éducation",
    entryTitle: "Programmez, apprenez et enseignez avec Python",
    entryLead:
      "Un environnement moderne pour apprendre la programmation avec Python, des blocs, du pseudocode, des diagrammes, du matériel et la gestion des classes.",
    entryCapPython: "Python",
    entryCapBlocks: "Blocs",
    entryCapHardware: "Matériel",
    entryCapClasses: "Classes",
    entryGoogleContinue: "Continuer avec Google",
    entryGoogleSignIn: "Se connecter avec Google",
    entryGoogleLoading: "Connexion à Google…",
    entryGoogleDisabled: "Google indisponible",
    entryLanguage: "Langue",
    entryIdeLink: "Ouvrir l’IDE sans compte",
    entryDashboardLink: "Aller au tableau de bord",
    entrySessionNotice:
      "Une session est déjà enregistrée dans ce navigateur. Vous pouvez ouvrir le tableau de bord ou vous déconnecter là-bas.",
    entryClassroomHint:
      "Google Classroom se connecte ensuite, lorsque vous importez des cours.",
    entryLeadSupabase: "Un compte par e-mail. Connectez-vous avec Google pour utiliser PyBot.",
    entryLeadGis: "Connectez-vous avec votre compte Google.",
    entryLeadStub: "Configurez la connexion Google pour cette installation.",
    entryStubHint:
      "Copiez .env.example vers .env et définissez VITE_GOOGLE_CLIENT_ID ou Supabase (VITE_SUPABASE_*). Redémarrez le serveur de développement.",
  },
  pt: {
    entryBrand: "PyBot",
    entryTagline: "Tecnologia · Educação",
    entryTitle: "Programe, aprenda e ensine com Python",
    entryLead:
      "Um ambiente moderno para aprender programação com Python, blocos, pseudocódigo, diagramas, hardware e gestão de turmas.",
    entryCapPython: "Python",
    entryCapBlocks: "Blocos",
    entryCapHardware: "Hardware",
    entryCapClasses: "Turmas",
    entryGoogleContinue: "Continuar com o Google",
    entryGoogleSignIn: "Entrar com o Google",
    entryGoogleLoading: "Conectando ao Google…",
    entryGoogleDisabled: "Google indisponível",
    entryLanguage: "Idioma",
    entryIdeLink: "Abrir IDE sem conta",
    entryDashboardLink: "Ir ao painel",
    entrySessionNotice:
      "Já existe uma sessão salva neste navegador. Você pode ir ao painel ou sair por lá.",
    entryClassroomHint:
      "O Google Classroom conecta depois, quando você importar cursos.",
    entryLeadSupabase: "Uma conta por e-mail. Entre com o Google para usar o PyBot.",
    entryLeadGis: "Entre com sua conta do Google.",
    entryLeadStub: "Configure o login com Google para esta instalação.",
    entryStubHint:
      "Copie .env.example para .env e defina VITE_GOOGLE_CLIENT_ID ou Supabase (VITE_SUPABASE_*). Reinicie o servidor de desenvolvimento.",
  },
};
