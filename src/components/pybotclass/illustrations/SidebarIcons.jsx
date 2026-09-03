const S = 1.85;

export function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4.5 10.5 12 4.5l7.5 6V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19v-8.5Z" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M9.5 20.5V14a2.5 2.5 0 0 1 5 0v6.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </svg>
  );
}

export function IconCourses() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 8.5 12 5l7 3.5v7L12 19l-7-3.5v-7Z" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M12 12v7M19 8.5 12 12 5 8.5" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M15.5 6.8 12 8.5 8.5 6.8" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </svg>
  );
}

export function IconCode() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8.5 8 5 12l3.5 4M15.5 8 19 12l-3.5 4" stroke="currentColor" strokeWidth={S} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 7 10.5 17" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </svg>
  );
}

export function IconClassroom() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth={S} />
      <path d="M8 9.5h8M8 13h5.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
      <circle cx="17" cy="8" r="2.5" fill="currentColor" opacity="0.25" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function IconInstitution() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 9.5 12 5l7 4.5V19H5V9.5Z" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M9.5 19v-5h5v5" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </svg>
  );
}

export function IconAccount() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth={S} />
      <path d="M6.5 19c.9-3 2.8-4.5 5.5-4.5s4.6 1.5 5.5 4.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth={S} opacity="0.55" />
    </svg>
  );
}

export function IconSuperAdmin() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4.5 13.8 9l4.7.4-3.6 3.1 1.1 4.6L12 15.2 7.9 17.1l1.1-4.6-3.6-3.1 4.7-.4L12 4.5Z" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M8.5 19.5h7" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </svg>
  );
}

export function IconMyContent() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5.5 7.5h13A1.5 1.5 0 0 1 20 9v10.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5V9A1.5 1.5 0 0 1 5.5 7.5Z"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <path d="M8 5.5h8M12 5.5V7.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
      <path d="M8 12h8M8 15.5h5.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </svg>
  );
}

export function GoogleClassroomIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="1" y="1" width="16" height="16" rx="4" fill="#fff" />
      <circle cx="9" cy="9" r="5.5" fill="#4285F4" opacity="0.14" />
      <text x="9" y="11.8" textAnchor="middle" fill="#1A73E8" fontSize="8.5" fontWeight="800" fontFamily="Inter, sans-serif">
        G
      </text>
    </svg>
  );
}

const SIDEBAR_ICONS = {
  home: IconHome,
  courses: IconCourses,
  content: IconMyContent,
  ide: IconCode,
  classroom: IconClassroom,
  institutions: IconInstitution,
  account: IconAccount,
};

export function SidebarIcon({ id }) {
  const Cmp = SIDEBAR_ICONS[id];
  return Cmp ? <Cmp /> : null;
}
