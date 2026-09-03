export default function EmptyCoursesIllustration() {
  return (
    <svg viewBox="0 0 90 90" fill="none" aria-hidden className="pbc-empty-illus">
      <defs>
        <linearGradient id="emp-bg" x1="10" y1="8" x2="80" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DBEAFE" />
          <stop offset="1" stopColor="#EDE9FE" />
        </linearGradient>
        <linearGradient id="emp-book" x1="22" y1="38" x2="50" y2="72" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id="emp-panel" x1="44" y1="30" x2="74" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#312E81" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="74" height="74" rx="18" fill="url(#emp-bg)" />
      <rect x="20" y="42" width="26" height="32" rx="5" fill="url(#emp-book)" opacity="0.9" />
      <path d="M33 42V36a2 2 0 0 1 2-2h10l4 4v2" stroke="#BFDBFE" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="44" y="30" width="32" height="26" rx="6" fill="url(#emp-panel)" />
      <path d="M50 42 54 46 50 50" stroke="#67E8F9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M58 50h10" stroke="#A5B4FC" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M36 20 48 14l12 6-12 6-12-6Z" fill="#2563EB" opacity="0.85" />
      <rect x="42" y="24" width="6" height="4" rx="1" fill="#1D4ED8" />
      <circle cx="62" cy="62" r="8" fill="#C4B5FD" opacity="0.55" />
      <path d="M59 62h6M62 59v6" stroke="#7C3AED" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
