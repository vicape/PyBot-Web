export default function JoinCourseIllustration() {
  return (
    <svg viewBox="0 0 110 110" fill="none" aria-hidden className="pbc-illus">
      <defs>
        <linearGradient id="joi-bg" x1="25" y1="12" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C4B5FD" stopOpacity="0.4" />
          <stop offset="1" stopColor="#818CF8" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="joi-link" x1="28" y1="40" x2="82" y2="72" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <circle cx="78" cy="28" r="30" fill="url(#joi-bg)" />
      <rect x="24" y="44" width="22" height="28" rx="11" fill="url(#joi-link)" opacity="0.85" />
      <rect x="64" y="44" width="22" height="28" rx="11" fill="url(#joi-link)" />
      <path
        d="M46 58h18"
        stroke="#A78BFA"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="35" cy="58" r="4" fill="#EDE9FE" />
      <circle cx="75" cy="58" r="4" fill="#EDE9FE" />
      <path
        d="M30 36c2-6 8-10 16-10s14 4 16 10"
        stroke="#7C3AED"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M78 78c-2 5-7 8-14 8s-12-3-14-8"
        stroke="#6D28D9"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}
