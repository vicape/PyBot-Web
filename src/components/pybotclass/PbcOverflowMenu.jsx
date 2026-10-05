import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n.js";
import PbcIcon from "./PbcIcon.jsx";

/**
 * Reusable PyBotClass overflow menu.
 * Owns the trigger, menu panel, click-outside close, and Escape close.
 *
 * @param {{
 *   "aria-label"?: string,
 *   className?: string,
 *   children: import("react").ReactNode | ((close: () => void) => import("react").ReactNode),
 * }} props
 */
export default function PbcOverflowMenu({
  "aria-label": ariaLabel,
  className,
  children,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerOutside);
    document.addEventListener("mousedown", onPointerOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerOutside);
      document.removeEventListener("mousedown", onPointerOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={["pbc-overflow-menu", className].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        className="pbc-overflow-menu__trigger"
        aria-label={ariaLabel || t("pcMoreOptions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden>
          <PbcIcon name="more" size={18} />
        </span>
      </button>
      {open ? (
        <div
          className="pbc-overflow-menu__panel"
          role="menu"
          onClick={(e) => {
            if (e.target.closest?.('[role="menuitem"]')) close();
          }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
