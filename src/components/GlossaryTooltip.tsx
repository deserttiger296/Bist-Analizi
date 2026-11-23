"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { getGlossaryEntry, type GlossaryCategory } from "@/lib/glossary";

export interface TermHintProps {
  id: string;
  label?: string;
  className?: string;
}

const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  teknik: "Teknik",
  itki: "İtki",
  risk: "Risk",
  viop: "VİOP",
};

const CATEGORY_BADGE_CLASSES: Record<GlossaryCategory, string> = {
  teknik: "border-cyan-500/40 bg-cyan-950/60 text-cyan-200",
  itki: "border-violet-500/40 bg-violet-950/60 text-violet-200",
  risk: "border-amber-500/40 bg-amber-950/60 text-amber-200",
  viop: "border-emerald-500/40 bg-emerald-950/60 text-emerald-200",
};

export function TermHint({ id, label, className = "" }: TermHintProps) {
  const entry = getGlossaryEntry(id);
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
  }>({ top: 12, left: 12, width: 280 });

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  }, [clearCloseTimer]);

  const closePopover = useCallback(
    (restoreFocus = false) => {
      clearCloseTimer();
      setOpen(false);
      setPinned(false);
      if (restoreFocus) {
        triggerRef.current?.focus();
      }
    },
    [clearCloseTimer]
  );

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === "undefined") return;
    const gutter = 12;
    const gap = 8;
    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(300, Math.max(220, vw - gutter * 2));
    const measuredH = popoverRef.current?.offsetHeight || 190;

    const idealLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(gutter, Math.min(idealLeft, vw - width - gutter));

    const spaceBelow = vh - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const placeAbove = spaceBelow < measuredH + gap && spaceAbove > spaceBelow;
    const top = placeAbove
      ? Math.max(gutter, rect.top - measuredH - gap)
      : Math.max(gutter, Math.min(vh - measuredH - gutter, rect.bottom + gap));

    setCoords({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const raf =
      typeof window !== "undefined"
        ? window.requestAnimationFrame(updatePosition)
        : 0;
    return () => {
      if (raf && typeof window !== "undefined") {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [open, updatePosition, id]);

  useEffect(() => {
    if (!open) return;

    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.stopPropagation();
        closePopover(true);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      closePopover(false);
    };

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, updatePosition, closePopover]);

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, [clearCloseTimer]);

  if (!entry) {
    return null;
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    clearCloseTimer();
    if (open && pinned) {
      closePopover(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  };

  const handleMouseEnter = () => {
    clearCloseTimer();
    if (!pinned) {
      setOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (!pinned) {
      scheduleHoverClose();
    }
  };

  const ariaLabel = label
    ? `${label} hakkında bilgi`
    : `${entry.title} nedir?`;

  const buttonNode = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-controls={open ? popoverId : undefined}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#3a506b] bg-[#152233] text-[10px] font-bold leading-none text-[#8ec8ea] transition-colors hover:border-[#69ddbb] hover:text-[#69ddbb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7de4c7] ${
        label ? "" : className
      }`}
    >
      ?
    </button>
  );

  const popoverNode =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label={entry.title}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={() => {
              if (!pinned) scheduleHoverClose();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              zIndex: 120,
            }}
            className="rounded-xl border border-[#2f455e] bg-[#0f1926] p-3.5 text-left text-slate-200 shadow-2xl shadow-black/80"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CATEGORY_BADGE_CLASSES[entry.category]}`}
                >
                  {CATEGORY_LABELS[entry.category]}
                </span>
                <div className="mt-1 text-xs font-bold text-[#eaf0f6]">
                  {entry.title}
                </div>
              </div>
              <button
                type="button"
                aria-label={`${entry.title} açıklamasını kapat`}
                onClick={(e) => {
                  e.stopPropagation();
                  closePopover(true);
                }}
                className="shrink-0 rounded-md border border-[#2b3c52] bg-[#152233] px-1.5 py-0.5 text-[11px] font-semibold text-slate-300 hover:border-[#69ddbb] hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-200">
              {entry.plain}
            </p>
            <div className="mt-2.5 rounded-lg border border-[#223247] bg-[#0b131e] px-2.5 py-2 text-[11px] leading-relaxed text-[#9dc4db]">
              <span className="font-semibold text-[#69ddbb]">Örnek: </span>
              {entry.example}
            </div>
          </div>,
          document.body
        )
      : null;

  if (label) {
    return (
      <span className={`inline-flex items-center gap-1 align-middle ${className}`}>
        <span>{label}</span>
        {buttonNode}
        {popoverNode}
      </span>
    );
  }

  return (
    <>
      {buttonNode}
      {popoverNode}
    </>
  );
}

export default TermHint;
