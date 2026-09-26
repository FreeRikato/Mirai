import { useState, type ReactNode } from "react";

const EDGE = 180;

type Anchor = { readonly top: number; readonly left: number; readonly right: number };

export function useHoverTip<T>() {
  const [tip, setTip] = useState<{ readonly value: T; readonly anchor: Anchor } | null>(null);
  const show = (el: Element, value: T) => {
    const r = el.getBoundingClientRect();
    setTip({ value, anchor: { top: r.top, left: r.left, right: r.right } });
  };
  const hide = () => setTip(null);
  return { tip, show, hide };
}

export function HoverTip({ anchor, children }: { anchor: Anchor; children: ReactNode }) {
  const center = (anchor.left + anchor.right) / 2;
  const nearRight = center > window.innerWidth - EDGE;
  const nearLeft = center < EDGE;
  const left = nearRight ? anchor.right : nearLeft ? anchor.left : center;
  const shift = nearRight ? "-100%" : nearLeft ? "0" : "-50%";
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 border border-rule bg-popover px-2.5 py-2 text-[10px] whitespace-nowrap"
      style={{ top: anchor.top - 6, left, transform: `translate(${shift}, -100%)` }}
    >
      {children}
    </div>
  );
}
