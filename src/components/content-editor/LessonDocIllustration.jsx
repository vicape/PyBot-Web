export default function LessonDocIllustration() {
  return (
    <svg
      className="pbc-lesson-hero__art"
      viewBox="0 0 100 100"
      width="100"
      height="100"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="pbcLessonGlow" x1="20" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
          <stop stopColor="#93C5FD" stopOpacity="0.55" />
          <stop stopColor="#C4B5FD" stopOpacity="0.35" />
          <stop stopColor="#67E8F9" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="pbcLessonPaper" x1="28" y1="18" x2="78" y2="86" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#EEF4FF" />
        </linearGradient>
      </defs>
      <circle cx="52" cy="50" r="38" fill="url(#pbcLessonGlow)" />
      <rect x="28" y="18" width="44" height="58" rx="10" fill="url(#pbcLessonPaper)" stroke="#BFDBFE" strokeWidth="1.5" />
      <path d="M56 18v14a4 4 0 0 0 4 4h14" stroke="#93C5FD" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M38 42h22M38 50h18M38 58h14" stroke="#3B6EF5" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
      <circle cx="70" cy="68" r="12" fill="#7C4DFF" />
      <path d="M65.5 68.2l2.8 2.8 6.2-6.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34" cy="26" r="3" fill="#0EA5C6" opacity="0.7" />
    </svg>
  );
}
