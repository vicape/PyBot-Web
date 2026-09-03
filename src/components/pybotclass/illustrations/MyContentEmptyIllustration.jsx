export default function MyContentEmptyIllustration() {
  return (
    <svg viewBox="0 0 90 90" fill="none" aria-hidden className="pbc-empty-illus">
      <defs>
        <linearGradient id="mc-empty-bg" x1="8" y1="8" x2="82" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EEF4FF" />
          <stop offset="1" stopColor="#F1ECFF" />
        </linearGradient>
        <linearGradient id="mc-empty-book" x1="20" y1="36" x2="48" y2="72" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="74" height="74" rx="18" fill="url(#mc-empty-bg)" />
      <rect x="18" y="38" width="28" height="34" rx="5" fill="url(#mc-empty-book)" opacity="0.9" />
      <rect x="34" y="32" width="28" height="34" rx="5" fill="#A5B4FC" opacity="0.75" />
      <path d="M30 38V32a2 2 0 0 1 2-2h10l4 4v4" stroke="#BFDBFE" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="48" y="28" width="24" height="20" rx="5" fill="#312E81" opacity="0.85" />
      <path d="M52 36h12M52 40h8" stroke="#A5B4FC" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M36 18 45 14l9 4-9 4-9-4Z" fill="#2563EB" opacity="0.8" />
    </svg>
  );
}
