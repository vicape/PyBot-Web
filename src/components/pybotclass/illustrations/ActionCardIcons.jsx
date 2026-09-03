const STROKE = 1.9;

export function CoursesActionIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <path
        d="M4.5 8.5 13 4.5l8.5 4v9L13 21.5l-8.5-4v-9Z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path d="M13 12.5v9M21.5 8.5 13 12.5 4.5 8.5" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round" />
    </svg>
  );
}

export function CreateCourseActionIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <rect x="4.5" y="5.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth={STROKE} />
      <path d="M13 10v6M10 13h6" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  );
}

export function JoinCourseActionIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <path
        d="M7.5 11.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
        stroke="currentColor"
        strokeWidth={STROKE}
      />
      <path
        d="M18.5 18.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
        stroke="currentColor"
        strokeWidth={STROKE}
      />
      <path
        d="M10 9.5h3.5l2 2.5-2 2.5H10"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IdeActionIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <path d="M9 8 5.5 13 9 18" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 8 20.5 13 17 18" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 7 11.5 19" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  );
}
