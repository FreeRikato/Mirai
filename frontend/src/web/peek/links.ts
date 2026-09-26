import { useEffect } from "react";
import { peekOf } from "@/shared/refs";
import { openPeek } from "../router";

export function openLink(url: string, native: boolean): void {
  const peek = native ? null : peekOf(url);
  if (peek) openPeek(peek);
  else window.open(url, "_blank", "noopener");
}

const wantsNewTab = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

export function usePeekLinks(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wantsNewTab(e) || !(e.target instanceof Element)) return;
      const anchor = e.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.dataset.external !== undefined) return;
      const peek = peekOf(anchor.href);
      if (!peek) return;
      e.preventDefault();
      openPeek(peek);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
}
