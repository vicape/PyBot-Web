/** Shared functional SVG icons for PyBotClass actions/states (currentColor). */
const S = 1.85;

function Svg({ children, size = 18, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export function IconPeople({ size } = {}) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="8.5" r="3" stroke="currentColor" strokeWidth={S} />
      <path
        d="M3.5 19c.8-3 2.7-4.5 5.5-4.5s4.7 1.5 5.5 4.5"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinecap="round"
      />
      <circle cx="17" cy="9.5" r="2.4" stroke="currentColor" strokeWidth={S} />
      <path
        d="M14.2 19c.4-1.8 1.5-2.8 2.8-2.8 1.2 0 2.1.6 2.7 1.7"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconClipboard({ size } = {}) {
  return (
    <Svg size={size}>
      <rect x="6" y="5" width="12" height="15" rx="2" stroke="currentColor" strokeWidth={S} />
      <path d="M9 5.5V4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5v1" stroke="currentColor" strokeWidth={S} />
      <path d="M9 11h6M9 14.5h4" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function IconGrade({ size } = {}) {
  return (
    <Svg size={size}>
      <path
        d="M5 12.5 9.5 17 19 7.5"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke="currentColor" strokeWidth={S} opacity="0.45" />
    </Svg>
  );
}

export function IconAssign({ size } = {}) {
  return (
    <Svg size={size}>
      <path
        d="M8 7.5h9.5A1.5 1.5 0 0 1 19 9v9.5A1.5 1.5 0 0 1 17.5 20H8A1.5 1.5 0 0 1 6.5 18.5V9A1.5 1.5 0 0 1 8 7.5Z"
        stroke="currentColor"
        strokeWidth={S}
      />
      <path d="M10 4.5h4" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
      <path d="M10.5 13.5 12 15l3-3.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconOpen({ size } = {}) {
  return (
    <Svg size={size}>
      <path
        d="M10 5.5H7A1.5 1.5 0 0 0 5.5 7v10A1.5 1.5 0 0 0 7 18.5h10a1.5 1.5 0 0 0 1.5-1.5v-3"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinecap="round"
      />
      <path d="M12.5 5.5H18.5V11.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 13 18.5 5.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function IconShare({ size } = {}) {
  return (
    <Svg size={size}>
      <circle cx="6.5" cy="12" r="2.25" stroke="currentColor" strokeWidth={S} />
      <circle cx="17.5" cy="6.5" r="2.25" stroke="currentColor" strokeWidth={S} />
      <circle cx="17.5" cy="17.5" r="2.25" stroke="currentColor" strokeWidth={S} />
      <path d="M8.5 11.2 15.2 7.6M8.5 12.8 15.2 16.4" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function IconCopy({ size } = {}) {
  return (
    <Svg size={size}>
      <rect x="8" y="8" width="11" height="11" rx="2" stroke="currentColor" strokeWidth={S} />
      <path
        d="M6.5 15.5H6A1.5 1.5 0 0 1 4.5 14V6A1.5 1.5 0 0 1 6 4.5h8A1.5 1.5 0 0 1 15.5 6v.5"
        stroke="currentColor"
        strokeWidth={S}
      />
    </Svg>
  );
}

export function IconEdit({ size } = {}) {
  return (
    <Svg size={size}>
      <path
        d="M14 5.5 18.5 10M5.5 18.5l1.2-4.4L15.8 5.5 19 8.7 10.4 17.3 6 18.5Z"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconCreate({ size } = {}) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth={S} />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function IconLock({ size } = {}) {
  return (
    <Svg size={size}>
      <rect x="6" y="10.5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth={S} />
      <path d="M9 10.5V8a3 3 0 0 1 6 0v2.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function IconPublished({ size } = {}) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth={S} />
      <path d="M8 12.2 10.8 15 16 9.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconDraft({ size } = {}) {
  return (
    <Svg size={size}>
      <path
        d="M7 4.5h7.5L19 9v10.5A1.5 1.5 0 0 1 17.5 21h-10A1.5 1.5 0 0 1 6 19.5v-13A1.5 1.5 0 0 1 7 4.5Z"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <path d="M14 4.5V9h4.5" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
      <path d="M9 13h6M9 16.5h4" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function IconCourseCompact({ size } = {}) {
  return (
    <Svg size={size}>
      <path
        d="M5 8.5 12 5l7 3.5v7L12 19l-7-3.5v-7Z"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <path d="M12 12v7M19 8.5 12 12 5 8.5" stroke="currentColor" strokeWidth={S} strokeLinejoin="round" />
    </Svg>
  );
}

export function IconCommunityEmpty({ size = 40 } = {}) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth={S} />
      <circle cx="16.5" cy="10.5" r="2.6" stroke="currentColor" strokeWidth={S} />
      <path
        d="M3.5 19c.8-3.2 2.8-4.8 5.5-4.8s4.7 1.6 5.5 4.8"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinecap="round"
      />
      <path
        d="M13.2 19c.5-2.2 1.8-3.4 3.5-3.4 1.4 0 2.5.7 3.2 2"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Badge-sized community / courses share mark (same stroke language as ActionIcons). */
export function IconSharedCommunity({ size = 12 } = {}) {
  return <IconCommunityEmpty size={size} />;
}

export function IconSharedCourses({ size = 12 } = {}) {
  return <IconCourseCompact size={size} />;
}

export function IconContentType({ size = 20 } = {}) {
  return (
    <Svg size={size}>
      <path
        d="M5.5 7.5h13A1.5 1.5 0 0 1 20 9v10.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5V9A1.5 1.5 0 0 1 5.5 7.5Z"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <path d="M8 5.5h8M12 5.5V7.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
      <path d="M8 12h8M8 15.5h5.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

/** Compact action-card icons (same stroke language, smaller). */
export function CompactCreateIcon() {
  return <IconCreate size={22} />;
}

export function CompactContentIcon() {
  return (
    <Svg size={22}>
      <path
        d="M5.5 7.5h13A1.5 1.5 0 0 1 20 9v10.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5V9A1.5 1.5 0 0 1 5.5 7.5Z"
        stroke="currentColor"
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <path d="M8 12h8M8 15.5h5.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function CompactJoinIcon() {
  return (
    <Svg size={22}>
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth={S} />
      <path d="M4 19c.8-3 2.7-4.5 5-4.5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
      <path d="M15 11h5M17.5 8.5v5" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

export function CompactIdeIcon() {
  return (
    <Svg size={22}>
      <path d="M8.5 8 5 12l3.5 4M15.5 8 19 12l-3.5 4" stroke="currentColor" strokeWidth={S} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 7 10.5 17" stroke="currentColor" strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}
