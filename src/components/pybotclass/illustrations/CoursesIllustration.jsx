export default function CoursesIllustration() {
  return (
    <svg viewBox="0 0 110 110" fill="none" aria-hidden className="pbc-illus">
      <defs>
        <linearGradient id="crs-bg" x1="20" y1="10" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#93C5FD" stopOpacity="0.35" />
          <stop offset="1" stopColor="#6366F1" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="crs-book1" x1="18" y1="48" x2="42" y2="88" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
        <linearGradient id="crs-book2" x1="34" y1="42" x2="58" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818CF8" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id="crs-cap" x1="52" y1="18" x2="88" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563EB" />
          <stop offset="1" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
      <circle cx="78" cy="32" r="34" fill="url(#crs-bg)" />
      <rect x="20" y="52" width="24" height="32" rx="4" fill="url(#crs-book1)" opacity="0.92" />
      <rect x="36" y="46" width="24" height="36" rx="4" fill="url(#crs-book2)" />
      <path d="M42 46V38a2 2 0 0 1 2-2h20l6 6v4" stroke="#C7D2FE" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M54 24 72 32 54 40 36 32 54 24Z" fill="url(#crs-cap)" />
      <rect x="50" y="38" width="8" height="5" rx="1.5" fill="#1D4ED8" opacity="0.85" />
      <path d="M58 58h18v22a3 3 0 0 1-3 3H46a3 3 0 0 1-3-3V58" fill="#BFDBFE" opacity="0.55" />
      <path d="M70 62v16" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
