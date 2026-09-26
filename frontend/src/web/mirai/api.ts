import { useQuery, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { MiraiEventSchema, MiraiStatusSchema, ThreadSchema, ThreadSummarySchema, type Thread } from "@/shared/mirai";
import { applyEvent, splitRecords, startTurn, type LiveTurn } from "./live";

export const miraiKeys = {
  status: ["mirai", "status"] as const,
  threads: ["mirai", "threads"] as const,
  thread: (id: string) => ["mirai", "thread", id] as const,
};

type MiraiUi = {
  threadId: string | null;
  panel: "thread" | "history";
  live: LiveTurn | null;
  notice: string | null;
};

export const useMirai = create<MiraiUi>()(
  persist((): MiraiUi => ({ threadId: null, panel: "thread", live: null, notice: null }), {
    name: "mirai-thread",
    storage: createJSONStorage(() => localStorage),
    partialize: s => ({ threadId: s.threadId }),
  }),
);

const ErrorSchema = z.object({ error: z.string() });

async function fetchJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const res = await fetch(path);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(ErrorSchema.safeParse(body).data?.error ?? `${path} -> ${res.status}`);
  return schema.parse(body);
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const errorOf = async (res: Response): Promise<string> => ErrorSchema.safeParse(await res.json().catch(() => null)).data?.error ?? `the hub answered ${res.status}`;

export const useMiraiStatus = () => useQuery({ queryKey: miraiKeys.status, queryFn: () => fetchJson("/api/mirai/status", MiraiStatusSchema), staleTime: 60_000 });

export const useThreads = (enabled: boolean) => useQuery({ queryKey: miraiKeys.threads, queryFn: () => fetchJson("/api/mirai/threads", z.array(ThreadSummarySchema)), enabled });

async function fetchThread(id: string): Promise<Thread | null> {
  const res = await fetch(`/api/mirai/thread?id=${encodeURIComponent(id)}`);
  if (res.status === 404) {
    useMirai.setState(s => (s.threadId === id ? { threadId: null } : {}));
    return null;
  }
  if (!res.ok) throw new Error(await errorOf(res));
  return ThreadSchema.parse(await res.json());
}

export const useThread = (id: string | null, enabled: boolean) =>
  useQuery({
    queryKey: miraiKeys.thread(id ?? ""),
    queryFn: () => fetchThread(id ?? ""),
    enabled: id !== null && enabled,
    staleTime: 30_000,
    refetchInterval: q => (q.state.data?.busy ? 2_000 : false),
  });

const update = (fn: (live: LiveTurn) => LiveTurn) => useMirai.setState(s => (s.live ? { live: fn(s.live) } : {}));

function settle(qc: QueryClient, thread: Thread) {
  qc.setQueryData(miraiKeys.thread(thread.id), thread);
  void qc.invalidateQueries({ queryKey: miraiKeys.threads });
  useMirai.setState({ live: null, threadId: thread.id });
}

export async function ask(qc: QueryClient, question: string, view: string): Promise<boolean> {
  const { live, threadId } = useMirai.getState();
  if (answering(live)) {
    useMirai.setState({ notice: "mirAI is still answering; ask again when it finishes" });
    return false;
  }
  useMirai.setState({ live: startTurn(threadId, question, view, Date.now()), notice: null, panel: "thread" });
  let settled = false;
  try {
    const res = await post("/api/mirai/ask", { threadId, question, view });
    if (!res.ok || !res.body) {
      const message = await errorOf(res);
      useMirai.setState({ live: null, notice: message, ...(res.status === 404 ? { threadId: null } : {}) });
      if (res.status === 503) void qc.invalidateQueries({ queryKey: miraiKeys.status });
      if (res.status === 409 && threadId) void qc.invalidateQueries({ queryKey: miraiKeys.thread(threadId) });
      settled = true;
      return false;
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const out = splitRecords(rest + value);
      rest = out.rest;
      for (const record of out.records) {
        const parsed = MiraiEventSchema.safeParse(JSON.parse(record));
        if (!parsed.success) continue;
        const e = parsed.data;
        if (e.type === "thread") useMirai.setState({ threadId: e.threadId });
        if (e.type === "done") {
          settle(qc, e.thread);
          settled = true;
        } else update(t => applyEvent(t, e));
      }
    }
  } catch (err: unknown) {
    update(t => ({ ...t, error: err instanceof Error ? err.message : String(err) }));
  } finally {
    if (!settled) update(t => ({ ...t, error: t.error ?? "lost the connection to the hub before the answer finished" }));
  }
  return true;
}

export async function stop(qc: QueryClient, threadId: string): Promise<void> {
  const res = await post("/api/mirai/stop", { threadId });
  if (!res.ok) useMirai.setState({ notice: `could not stop: ${await errorOf(res)}` });
  void qc.invalidateQueries({ queryKey: miraiKeys.thread(threadId) });
}

export async function removeThread(qc: QueryClient, id: string): Promise<void> {
  const res = await post("/api/mirai/delete", { threadId: id });
  if (!res.ok && res.status !== 404) throw new Error(await errorOf(res));
  if (useMirai.getState().threadId === id) useMirai.setState({ threadId: null });
  qc.removeQueries({ queryKey: miraiKeys.thread(id) });
  await qc.invalidateQueries({ queryKey: miraiKeys.threads });
}

export const answering = (live: LiveTurn | null): boolean => live !== null && live.error === null;

export const newThread = () => useMirai.setState(s => (answering(s.live) ? {} : { threadId: null, panel: "thread", notice: null, live: null }));
