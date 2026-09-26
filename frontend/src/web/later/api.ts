import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { byQueueOrder, reslot, youtubePlaylistId, type Highlight, type LaterFolder, type LaterItem, type NewHighlight, type LaterKind, type LaterReader, type LaterState, type SaveOutcome, type Skip, type Transcript, type WorthSnapshot } from "@/shared/later";
import type { Social } from "@/shared/social";
import { get } from "../api";

export const laterKeys = { all: ["later"] as const, folders: ["later", "folders"] as const, worth: (kind: LaterKind) => ["later", "worth", kind] as const, reader: (id: string) => ["later", "reader", id] as const, social: (id: string) => ["later", "social", id] as const, highlights: (id: string) => ["later", "highlights", id] as const, transcript: (id: string) => ["later", "transcript", id] as const, skips: (id: string) => ["later", "skips", id] as const };

const ErrorSchema = z.object({ error: z.string() });

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return res.json();
  const e = ErrorSchema.safeParse(await res.json().catch(() => null));
  throw new Error(e.success ? e.data.error : `${path} failed (${res.status})`);
}

const replace = (qc: QueryClient, item: LaterItem) => qc.setQueryData<LaterItem[]>(laterKeys.all, list => (list ? [item, ...list.filter(i => i.id !== item.id)].sort(byQueueOrder) : [item]));

const SCORING_WINDOW_MS = 60_000;
const SCORING_POLL_MS = 3_000;
const awaitingScore = (items: readonly LaterItem[] | undefined) => items?.some(i => i.worth === "unscored" && i.state === "unread" && Date.now() - i.savedAt < SCORING_WINDOW_MS) ?? false;

export const useLater = () =>
  useQuery({ queryKey: laterKeys.all, queryFn: () => get<LaterItem[]>("/api/later"), staleTime: 30_000, refetchInterval: q => (awaitingScore(q.state.data) ? SCORING_POLL_MS : false) });

export const useWorth = (kind: LaterKind) => useQuery({ queryKey: laterKeys.worth(kind), queryFn: () => get<WorthSnapshot>(`/api/later-worth/${kind}`), staleTime: 30_000 });

export function useRefreshWorth(kind: LaterKind) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => postJson<WorthSnapshot>(`/api/later-worth/${kind}/refresh`, {}), onSettled: () => qc.invalidateQueries({ queryKey: laterKeys.all }) });
}

export const useReader = (id: string, enabled: boolean) => useQuery({ queryKey: laterKeys.reader(id), queryFn: () => get<LaterReader>(`/api/later/${id}/reader`), enabled, staleTime: Infinity });

export const useSocial = (id: string) => useQuery({ queryKey: laterKeys.social(id), queryFn: () => get<Social>(`/api/later/${id}/social`), staleTime: 300_000 });

const TRANSCRIPT_POLL_MS: Partial<Record<Transcript["status"], number>> = { queued: 10_000, running: 2_000 };

export const useTranscript = (id: string, enabled: boolean) =>
  useQuery({ queryKey: laterKeys.transcript(id), queryFn: () => get<Transcript>(`/api/later/${id}/transcript`), enabled, staleTime: Infinity, refetchInterval: q => (q.state.data && TRANSCRIPT_POLL_MS[q.state.data.status]) ?? false });

export const useSkips = (id: string, enabled: boolean) => useQuery({ queryKey: laterKeys.skips(id), queryFn: () => get<Skip[]>(`/api/later/${id}/skips`), enabled, staleTime: Infinity });

export function useRetryTranscript(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => postJson<Transcript>(`/api/later/${id}/transcript/retry`, {}), onSuccess: t => qc.setQueryData(laterKeys.transcript(id), t) });
}

export const useHighlights = (id: string) => useQuery({ queryKey: laterKeys.highlights(id), queryFn: () => get<Highlight[]>(`/api/later/${id}/highlights`), staleTime: 60_000 });

export function useHighlightActions(itemId: string) {
  const qc = useQueryClient();
  const key = laterKeys.highlights(itemId);
  const edit = (change: (list: Highlight[]) => Highlight[]) => qc.setQueryData<Highlight[]>(key, list => change(list ?? []));
  const settle = () => qc.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: (h: NewHighlight) => postJson<Highlight>(`/api/later/${itemId}/highlights`, h),
    onSuccess: made => edit(list => [...list, made]),
    onSettled: settle,
  });
  const note = useMutation({
    mutationFn: (p: { id: string; note: string }) => postJson<Highlight>(`/api/later-highlights/${p.id}/note`, { note: p.note }),
    onMutate: p => edit(list => list.map(h => (h.id === p.id ? { ...h, note: p.note } : h))),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => postJson<{ ok: true }>(`/api/later-highlights/${id}/delete`, {}),
    onMutate: id => edit(list => list.filter(h => h.id !== id)),
    onSettled: settle,
  });
  return { add, note, remove };
}

export function useSave() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (url: string) => postJson<LaterItem>("/api/later", { url }), onSuccess: item => replace(qc, item) });
}

export type { SaveOutcome };

const saveOne = (url: string, folderId: string | null): Promise<SaveOutcome> => {
  const body = folderId ? { url, folderId } : { url };
  if (youtubePlaylistId(url)) return postJson<SaveOutcome>("/api/later-playlist", body);
  return postJson<LaterItem>("/api/later", body).then(item => ({ saved: [item], failed: [] }));
};

export function useSaveMany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ urls, folderId }: { urls: readonly string[]; folderId: string | null }): Promise<SaveOutcome> => {
      const settled = await Promise.allSettled(urls.map(url => saveOne(url, folderId)));
      return settled.reduce<SaveOutcome>(
        (out, s, n) => (s.status === "fulfilled" ? { saved: [...out.saved, ...s.value.saved], failed: [...out.failed, ...s.value.failed] } : { ...out, failed: [...out.failed, { url: urls[n] ?? "", error: s.reason instanceof Error ? s.reason.message : String(s.reason) }] }),
        { saved: [], failed: [] },
      );
    },
    onSuccess: out => out.saved.forEach(item => replace(qc, item)),
  });
}

export const useFolders = () => useQuery({ queryKey: laterKeys.folders, queryFn: () => get<LaterFolder[]>("/api/later-folders"), staleTime: 30_000 });

export function useFolderActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: laterKeys.folders });
    void qc.invalidateQueries({ queryKey: laterKeys.all, exact: true });
  };
  const create = useMutation({ mutationFn: (name: string) => postJson<LaterFolder>("/api/later-folders", { name }), onSettled: refresh });
  const rename = useMutation({ mutationFn: (f: { id: string; name: string }) => postJson<LaterFolder>(`/api/later-folders/${encodeURIComponent(f.id)}/rename`, { name: f.name }), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => postJson<LaterItem[]>(`/api/later-folders/${encodeURIComponent(id)}/delete`, {}), onSettled: refresh });
  const move = useMutation({
    mutationFn: (m: { id: string; folderId: string | null }) => postJson<LaterItem>(`/api/later/${m.id}/folder`, { folderId: m.folderId }),
    onSuccess: item => replace(qc, item),
    onError: refresh,
  });
  const reorder = useMutation({
    mutationFn: (o: { folderId: string; ids: readonly string[] }) => postJson<{ ok: true }>(`/api/later-folders/${encodeURIComponent(o.folderId)}/order`, { ids: o.ids }),
    onMutate: o => qc.setQueryData<LaterItem[]>(laterKeys.all, list => list?.map(i => (i.folder?.id === o.folderId && o.ids.includes(i.id) ? { ...i, folder: { id: o.folderId, order: o.ids.indexOf(i.id) + 1 } } : i))),
    onError: refresh,
  });
  const reorderQueue = useMutation({
    mutationFn: (ids: readonly string[]) => postJson<{ ok: true }>("/api/later-queue/order", { ids }),
    onMutate: ids =>
      qc.setQueryData<LaterItem[]>(laterKeys.all, list => {
        if (!list) return list;
        const next = reslot(list, ids);
        return list.map(i => ({ ...i, queueOrder: next.get(i.id) ?? i.queueOrder })).sort(byQueueOrder);
      }),
    onError: refresh,
  });
  return { create, rename, remove, move, reorder, reorderQueue };
}

export function usePatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; state?: LaterState; kind?: LaterKind }) => postJson<LaterItem>(`/api/later/${p.id}/update`, { state: p.state, kind: p.kind }),
    onMutate: p => qc.setQueryData<LaterItem[]>(laterKeys.all, list => list?.map(i => (i.id === p.id ? { ...i, state: p.state ?? i.state, kind: p.kind ?? i.kind } : i))),
    onSuccess: item => replace(qc, item),
    onError: () => qc.invalidateQueries({ queryKey: laterKeys.all }),
  });
}

export function useProgress() {
  const qc = useQueryClient();
  return (id: string, progress: number, position: number) =>
    postJson<LaterItem>(`/api/later/${id}/progress`, { progress: Math.min(1, Math.max(0, progress)), position: Math.max(0, position) }).then(
      item => replace(qc, item),
      () => undefined,
    );
}

export const useSend = () => useMutation({ mutationFn: (p: { id: string; machine: string }) => postJson<{ ok: true }>(`/api/later/${p.id}/send`, { machine: p.machine }) });
