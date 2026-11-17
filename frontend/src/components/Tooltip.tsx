import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The tooltip text, also read by screen readers as the trigger's description. */
  content: string;
  className?: string;
  children: ReactNode;
}

const EDGE = 136; // half the tooltip's max width + a margin, to keep it on screen

/**
 * A focusable trigger with a tooltip on hover and keyboard focus (and tap, on phones).
 * The tooltip is portalled to <body> with fixed positioning, so scrolling table wrappers can't clip it.
 */
export function Tooltip({ content, className = "", children }: Props) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const above = r.bottom + 110 > window.innerHeight;
    const x = Math.min(Math.max(r.left + r.width / 2, EDGE), Math.max(EDGE, window.innerWidth - EDGE));
    setPos({ x, y: above ? r.top - 6 : r.bottom + 6, above });
  }, []);
  const hide = useCallback(() => {
    setPos(null);
  }, []);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [pos, hide]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-describedby={id}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        {children}
      </button>
      {createPortal(
        <span
          id={id}
          role="tooltip"
          hidden={!pos}
          style={pos ? { left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.above ? "-100%" : "0"})` } : undefined}
          className="pointer-events-none fixed z-50 w-max max-w-64 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-snug text-ink shadow-lg"
        >
          {content}
        </span>,
        document.body,
      )}
    </>
  );
}
