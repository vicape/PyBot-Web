export default function IdeIllustration() {
  return (
    <svg viewBox="0 0 110 110" fill="none" aria-hidden className="pbc-illus">
      <defs>
        <linearGradient id="ide-bg" x1="20" y1="10" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818CF8" stopOpacity="0.35" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="ide-win" x1="20" y1="24" x2="90" y2="88" gradientUnits="userSpaceOnUse">
          <stop stopColor="#312E81" />
          <stop offset="1" stopColor="#1E1B4B" />
        </linearGradient>
      </defs>
      <circle cx="80" cy="26" r="32" fill="url(#ide-bg)" />
      <rect x="18" y="28" width="72" height="56" rx="10" fill="url(#ide-win)" />
      <rect x="18" y="28" width="72" height="12" rx="10" fill="#4338CA" opacity="0.9" />
      <circle cx="28" cy="34" r="2.2" fill="#F87171" />
      <circle cx="36" cy="34" r="2.2" fill="#FBBF24" />
      <circle cx="44" cy="34" r="2.2" fill="#34D399" />
      <path d="M28 52 36 58 28 64" stroke="#22D3EE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M44 64h20" stroke="#818CF8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M44 56h14" stroke="#A5B4FC" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
      <path d="M44 48h10" stroke="#C7D2FE" strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
      <text x="58" y="62" fill="#67E8F9" fontSize="11" fontFamily="monospace" fontWeight="700">
        {"</>"}
      </text>
    </svg>
  );
}
