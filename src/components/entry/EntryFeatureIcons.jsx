/** Decorative capability icons for the login landing feature rail. */

const STROKE = 1.75;

function IconShell({ children }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function FeatureIconPython() {
  return (
    <IconShell>
      <path
        d="M9 8 5.5 12 9 16"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 8 18.5 12 15 16"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.6 6.5 10.4 17.5" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </IconShell>
  );
}

export function FeatureIconBlocks() {
  return (
    <IconShell>
      <path
        d="M12 4.5c1.1 0 2 .9 2 2v1.2h1.3c1.3 0 2.4 1.1 2.4 2.4V12c0 1.1-.9 2-2 2h-1.2v1.3c0 1.3-1.1 2.4-2.4 2.4H10.8c-1.1 0-2-.9-2-2v-1.2H7.5c-1.3 0-2.4-1.1-2.4-2.4V11c0-1.1.9-2 2-2H8.3V7.7c0-1.3 1.1-2.4 2.4-2.4H12Z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </IconShell>
  );
}

export function FeatureIconHardware() {
  return (
    <IconShell>
      <rect x="7" y="7" width="10" height="10" rx="1.6" stroke="currentColor" strokeWidth={STROKE} />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth={STROKE} />
      <path
        d="M10 4.5v2.5M14 4.5v2.5M10 17v2.5M14 17v2.5M4.5 10h2.5M4.5 14h2.5M17 10h2.5M17 14h2.5"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconShell>
  );
}

export function FeatureIconClasses() {
  return (
    <IconShell>
      <path
        d="M3.5 10.2 12 6.2l8.5 4-8.5 4-8.5-4Z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M7.2 12.2v3.4c0 .9 2.1 2.2 4.8 2.2s4.8-1.3 4.8-2.2v-3.4"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M20.5 10.2v5.2" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </IconShell>
  );
}

export function FeatureIconProjects() {
  return (
    <IconShell>
      <path
        d="M13.2 4.8 19.2 10.8 10.5 13.5 7.8 10.8 13.2 4.8Z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M10.2 13.8 8.4 19.2l2.1-2.1 2.1 2.1-1.2-4.2"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M7.5 10.5 4.8 13.2"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconShell>
  );
}

const FEATURE_ICONS = {
  python: FeatureIconPython,
  blocks: FeatureIconBlocks,
  hardware: FeatureIconHardware,
  classes: FeatureIconClasses,
  projects: FeatureIconProjects,
};

export function EntryFeatureIcon({ id }) {
  const Icon = FEATURE_ICONS[id];
  if (!Icon) return null;
  return <Icon />;
}
