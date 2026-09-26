import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { px0Id, Px0OpenedSchema, type Px0Open, type Px0Session, type Px0Sessions } from "@/shared/px0";
import { get, keys, post, postFor } from "../api";

export const usePx0Sessions = (everyMs = 10_000) => useQuery({ queryKey: keys.px0, queryFn: () => get<Px0Sessions>("/api/px0"), refetchInterval: everyMs });

const tabFor = (id: string): Window | null => window.open("", `px0-${id}`);

const showing = (tab: Window, path: string): boolean => {
  try {
    return tab.location.pathname.startsWith(path);
  } catch {
    return false;
  }
};

export function showPx0({ id, path }: Pick<Px0Session, "id" | "path">): void {
  const tab = tabFor(id);
  if (!tab) return void window.open(path, "_blank");
  if (!showing(tab, path)) tab.location.href = path;
  tab.focus();
}

function waitingTab(id: string, label: string): Window | null {
  const tab = tabFor(id);
  if (!tab) return null;
  tab.document.title = `px0 · ${label}`;
  tab.document.body.style.cssText = "margin:0;padding:24px;background:#000;color:#8c8c8c;font:12px ui-monospace,monospace";
  tab.document.body.textContent = `starting px0 for ${label} on the hub`;
  return tab;
}

export function useOpenInPx0() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ target, tab }: { target: Px0Open; tab: Window | null }) => {
      try {
        const { path } = await postFor("/api/px0", target, Px0OpenedSchema);
        if (tab) tab.location.href = path;
        else window.open(path, "_blank");
      } catch (err: unknown) {
        tab?.close();
        throw err;
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.px0 }),
  });
  const open = (target: Px0Open, label: string) => {
    const id = px0Id(target.repo, target.number);
    const live = qc.getQueryData<Px0Sessions>(keys.px0)?.sessions.find(s => s.id === id && s.ready);
    if (live) showPx0(live);
    else mutation.mutate({ target, tab: waitingTab(id, label) });
  };
  return { open, pending: mutation.isPending, error: mutation.error?.message ?? null };
}

export function useStopPx0() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => post("/api/px0/stop", { id }), onSettled: () => qc.invalidateQueries({ queryKey: keys.px0 }) });
}
