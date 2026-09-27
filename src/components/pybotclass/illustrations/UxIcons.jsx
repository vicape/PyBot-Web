/**
 * Centralized PyBotClass UX icon map (public/ux-icons/).
 * Detailed artwork — prefer 36–56px on cards/headers; keep line icons at ≤20px.
 */

export const UX_ICON_PATHS = Object.freeze({
  home: "/ux-icons/home-dashboard.png",
  courses: "/ux-icons/courses-cards.png",
  content: "/ux-icons/lesson-content.png",
  ide: "/ux-icons/ide-code.png",
  community: "/ux-icons/community-group.png",
  aiChat: "/ux-icons/ai-chat.png",
  checklist: "/ux-icons/checklist.png",
  settings: "/ux-icons/settings-gear.png",
});

/**
 * @param {{ name: keyof typeof UX_ICON_PATHS, size?: number, className?: string, alt?: string }} props
 * Decorative by default (empty alt). Pass alt for meaningful standalone images.
 */
export function UxIcon({ name, size = 48, className = "", alt = "" }) {
  const src = UX_ICON_PATHS[name];
  if (!src) return null;
  const px = typeof size === "number" ? size : Number(size) || 48;
  return (
    <img
      src={src}
      alt={alt}
      width={px}
      height={px}
      decoding="async"
      draggable={false}
      className={`pbc-ux-icon${className ? ` ${className}` : ""}`}
      style={{ width: px, height: px }}
    />
  );
}
