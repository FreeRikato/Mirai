import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { SessionManager, type AgentSession, type AgentSessionEvent, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { withView, type Ask, type CitationCheck, type MiraiEvent, type Thread, type ThreadSummary } from "@/shared/mirai";
import type { Engine } from "./engine";
import { describeCall } from "./actions";
import { CITE_MARK, STOP_MARK, summaryOf, turnsOf } from "./transcript";

export class MiraiBusy extends Error {}
export class MiraiUnknownThread extends Error {}

type Live = { session: AgentSession; busy: boolean; stopping: boolean; lastUsed: number };

export function toEvent(e: AgentSessionEvent): MiraiEvent | null {
  switch (e.type) {
    case "message_update": {
      const a = e.assistantMessageEvent;
      if (a.type === "thinking_delta") return { type: "thinking", delta: a.delta };
      if (a.type === "text_delta") return { type: "text", delta: a.delta };
      return null;
    }
    case "tool_execution_start":
      return { type: "call", id: e.toolCallId, ...describeCall(e.toolName, e.args) };
    case "tool_execution_end":
      return { type: "call_end", id: e.toolCallId, ok: !e.isError };
    case "auto_retry_start":
      return { type: "retry", attempt: e.attempt, max: e.maxAttempts, delayMs: e.delayMs, error: e.errorMessage };
    default:
      return null;
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type Threads = ReturnType<typeof createThreads>;

export function createThreads(deps: { engine: Engine; dir: string; idleMs: number; now?: () => number; checkCitations?: (answer: string) => CitationCheck[] }) {
  const now = deps.now ?? Date.now;
  const cwd = deps.dir;
  const sessionsDir = `${deps.dir}/threads`;
  mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
  chmodSync(deps.dir, 0o700);
  chmodSync(sessionsDir, 0o700);
  const live = new Map<string, Live>();
  const citationsFor = (answer: string): CitationCheck[] => {
    try {
      return deps.checkCitations?.(answer) ?? [];
    } catch (err: unknown) {
      console.warn("mirai: checking citations failed", messageOf(err));
      return [];
    }
  };
  const opening = new Map<string, Promise<Live>>();
  const summaries = new Map<string, { modified: number; summary: ThreadSummary }>();

  const pathOf = (id: string) => SessionManager.findById(cwd, id, sessionsDir);

  const thread = (id: string, entries: readonly SessionEntry[], busy: boolean): Thread => {
    const turns = turnsOf(entries);
    const shown = busy ? turns.map((t, i) => (i === turns.length - 1 ? { ...t, status: "answering" as const, error: null } : t)) : turns;
    return { ...summaryOf(id, turns, now()), turns: shown, busy };
  };

  function evictIdle() {
    for (const [id, l] of live) {
      if (l.busy || now() - l.lastUsed < deps.idleMs) continue;
      l.session.dispose();
      live.delete(id);
    }
  }

  async function open(manager: SessionManager): Promise<Live> {
    const session = await deps.engine.open(manager);
    const l: Live = { session, busy: false, stopping: false, lastUsed: now() };
    live.set(session.sessionId, l);
    return l;
  }

  function liveFor(threadId: string | null): Promise<Live> {
    if (threadId === null) return open(SessionManager.create(cwd, sessionsDir));
    const known = live.get(threadId);
    if (known) return Promise.resolve(known);
    const pending = opening.get(threadId);
    if (pending) return pending;
    const path = pathOf(threadId);
    if (!path) return Promise.reject(new MiraiUnknownThread(`no mirAI thread ${threadId}`));
    const started = open(SessionManager.open(path, sessionsDir)).finally(() => opening.delete(threadId));
    opening.set(threadId, started);
    return started;
  }

  return {
    async begin(input: Ask) {
      evictIdle();
      const l = await liveFor(input.threadId);
      if (l.busy) throw new MiraiBusy("mirAI is still answering this thread on another device");
      l.busy = true;
      const threadId = l.session.sessionId;
      const run = async (emit: (e: MiraiEvent) => void) => {
        const off = l.session.subscribe(e => {
          const out = toEvent(e);
          if (out) emit(out);
        });
        try {
          emit({ type: "thread", threadId });
          await l.session.prompt(withView(input.view, input.question));
          if (l.stopping) l.session.sessionManager.appendCustomEntry(STOP_MARK);
          const checks = citationsFor(turnsOf(l.session.sessionManager.getEntries()).at(-1)?.answer ?? "");
          if (checks.length > 0) l.session.sessionManager.appendCustomEntry(CITE_MARK, checks);
          emit({ type: "done", thread: thread(threadId, l.session.sessionManager.getEntries(), false) });
        } catch (err: unknown) {
          emit({ type: "error", message: messageOf(err) });
        } finally {
          off();
          l.busy = false;
          l.stopping = false;
          l.lastUsed = now();
        }
      };
      return { threadId, run };
    },

    get(id: string): Thread | null {
      const l = live.get(id);
      if (l) return thread(id, l.session.sessionManager.getEntries(), l.busy);
      const path = pathOf(id);
      return path ? thread(id, SessionManager.open(path, sessionsDir).getEntries(), false) : null;
    },

    async list(): Promise<ThreadSummary[]> {
      const infos = await SessionManager.list(cwd, sessionsDir);
      const out = infos.map(info => {
        const modified = info.modified.getTime();
        const cached = summaries.get(info.path);
        if (cached?.modified === modified) return cached.summary;
        const summary = summaryOf(info.id, turnsOf(SessionManager.open(info.path, sessionsDir).getEntries()), modified);
        summaries.set(info.path, { modified, summary });
        return summary;
      });
      return out.filter(s => s.questions > 0).toSorted((a, b) => b.updatedAt - a.updatedAt);
    },

    async stop(id: string): Promise<boolean> {
      const l = live.get(id);
      if (!l?.busy) return false;
      l.stopping = true;
      await l.session.abort();
      return true;
    },

    async remove(id: string): Promise<boolean> {
      const l = live.get(id);
      if (l) {
        await l.session.abort();
        l.session.dispose();
        live.delete(id);
      }
      const path = pathOf(id);
      if (!path) return l !== undefined;
      rmSync(path, { force: true });
      summaries.delete(path);
      return true;
    },

    close() {
      for (const l of live.values()) l.session.dispose();
      live.clear();
    },
  };
}
