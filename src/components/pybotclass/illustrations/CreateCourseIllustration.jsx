export default function CreateCourseIllustration() {
  return (
    <svg viewBox="0 0 110 110" fill="none" aria-hidden className="pbc-illus">
      <defs>
        <linearGradient id="crt-bg" x1="30" y1="8" x2="100" y2="95" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5EEAD4" stopOpacity="0.35" />
          <stop offset="1" stopColor="#14B8A6" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="crt-panel" x1="24" y1="28" x2="88" y2="88" gradientUnits="userSpaceOnUse">
          <stop stopColor="#CCFBF1" />
          <stop offset="1" stopColor="#99F6E4" />
        </linearGradient>
        <linearGradient id="crt-avatar" x1="38" y1="42" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#0D9488" />
        </linearGradient>
      </defs>
      <circle cx="76" cy="30" r="32" fill="url(#crt-bg)" />
      <rect x="22" y="30" width="66" height="52" rx="10" fill="url(#crt-panel)" stroke="#99F6E4" strokeWidth="1.5" />
      <rect x="22" y="30" width="66" height="12" rx="10" fill="#5EEAD4" opacity="0.45" />
      <circle cx="30" cy="36" r="2" fill="#0F766E" opacity="0.5" />
      <circle cx="37" cy="36" r="2" fill="#0F766E" opacity="0.35" />
      <circle cx="44" cy="36" r="2" fill="#0F766E" opacity="0.25" />
      <circle cx="48" cy="52" r="10" fill="url(#crt-avatar)" />
      <path d="M36 68c1.5-4 4.5-6 12-6s10.5 2 12 6" stroke="#14B8A6" strokeWidth="2" strokeLinecap="round" />
      <rect x="62" y="48" width="18" height="4" rx="2" fill="#5EEAD4" opacity="0.8" />
      <rect x="62" y="56" width="14" height="4" rx="2" fill="#99F6E4" />
      <circle cx="82" cy="22" r="12" fill="#14B8A6" opacity="0.9" />
      <path d="M82 17v10M77 22h10" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
