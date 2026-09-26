import { useEffect, useState, useSyncExternalStore } from "react";
import { useSettings } from "./settings";

export function usePollInterval() {
  const { pollMs, cacheMs, catchUpMs } = useSettings().tasks;
  return (q: { state: { data: unknown } }) => {
    const d = q.state.data;
    const fetchedAt = typeof d === "object" && d !== null && "fetchedAt" in d && typeof d.fetchedAt === "number" ? d.fetchedAt : null;
    return fetchedAt !== null && Date.now() - fetchedAt > cacheMs ? catchUpMs : pollMs;
  };
}

export function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export const DESKTOP_QUERY = "(min-width: 48rem)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

export function useReveal(total: number, key: string) {
  const page = useSettings().lists.pageSize;
  const [state, setState] = useState({ key, shown: page });
  if (state.key !== key) setState({ key, shown: page });
  const shown = state.key === key ? Math.min(state.shown, total) : Math.min(page, total);
  const more = shown < total;
  const showMore = () => setState(s => ({ ...s, shown: s.shown + page }));
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!button) return;
    let armed = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      if (!e.isIntersecting) armed = true;
      else if (armed) {
        armed = false;
        setState(s => ({ ...s, shown: s.shown + page }));
      }
    });
    io.observe(button);
    return () => io.disconnect();
  }, [button, page, key]);

  const footer = more ? (
    <button
      ref={setButton}
      type="button"
      onClick={showMore}
      className="w-full cursor-pointer border-0 bg-transparent py-3 font-mono text-[11px] text-dim hover:text-fg"
    >
      show {Math.min(page, total - shown)} more
    </button>
  ) : null;
  return { shown, footer };
}
