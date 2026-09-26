import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { CitationCheckSchema, splitView, type ThreadSummary, type Turn } from "@/shared/mirai";
import { describeCall } from "./actions";

export const STOP_MARK = "mirai-stop";
export const CITE_MARK = "mirai-citations";

const ChecksSchema = z.array(CitationCheckSchema);

type Message = Extract<SessionEntry, { type: "message" }>["message"];
type Assistant = Extract<Message, { role: "assistant" }>;
type Step = { at: number; message: Assistant };

const textOf = (content: string | readonly { type: string; text?: string }[]): string =>
  typeof content === "string" ? content : content.flatMap(c => (c.type === "text" && c.text ? [c.text] : [])).join("\n");

const join = (a: string, b: string) => (a && b ? `${a}\n\n${b}` : a || b);

const CUT_OFF = "the answer was cut off before it finished";

function outcome(last: Assistant | undefined, stopped: boolean): Pick<Turn, "status" | "error"> {
  if (stopped || last?.stopReason === "aborted") return { status: "stopped", error: null };
  if (!last || last.stopReason === "toolUse" || last.stopReason === "pending" || last.stopReason === "deferred") return { status: "error", error: CUT_OFF };
  if (last.stopReason === "error") return { status: "error", error: last.errorMessage ?? "the model returned an error" };
  if (last.stopReason === "length") return { status: "error", error: "the answer hit the model's length limit" };
  return { status: "done", error: null };
}

export function turnsOf(entries: readonly SessionEntry[]): Turn[] {
  const turns: { turn: Turn; steps: Step[]; results: Map<string, boolean>; extraUsd: number; stopped: boolean }[] = [];
  for (const entry of entries) {
    const open = turns.at(-1);
    if (entry.type === "custom" && entry.customType === STOP_MARK && open) open.stopped = true;
    else if (entry.type === "custom" && entry.customType === CITE_MARK && open) open.turn.citations = ChecksSchema.catch([]).parse(entry.data);
    else if (entry.type === "usage" && open) open.extraUsd += entry.usage.cost.total;
    else if (entry.type === "compaction" && open && entry.usage) open.extraUsd += entry.usage.cost.total;
    if (entry.type !== "message") continue;
    const m = entry.message;
    if (m.role === "user") {
      const { view, question } = splitView(textOf(m.content));
      turns.push({ turn: { question, view, askedAt: m.timestamp, tookMs: 0, thinking: "", calls: [], answer: "", status: "done", error: null, costUsd: 0, citations: [] }, steps: [], results: new Map(), extraUsd: 0, stopped: false });
    } else if (m.role === "assistant" && open) open.steps.push({ at: Date.parse(entry.timestamp) || m.timestamp, message: m });
    else if (m.role === "toolResult" && open) open.results.set(m.toolCallId, !m.isError);
  }
  return turns.map(({ turn, steps, results, extraUsd, stopped }) => {
    const kept = steps.filter((s, i) => s.message.stopReason !== "error" || i === steps.length - 1);
    for (const { message } of kept) {
      for (const block of message.content) {
        if (block.type === "thinking") turn.thinking = join(turn.thinking, block.thinking.trim());
        else if (block.type === "text") turn.answer = join(turn.answer, block.text.trim());
        else turn.calls.push({ id: block.id, ...describeCall(block.name, block.arguments), ok: results.get(block.id) ?? null });
      }
    }
    const last = steps.at(-1);
    return {
      ...turn,
      ...outcome(last?.message, stopped),
      tookMs: last ? Math.max(0, last.at - turn.askedAt) : 0,
      costUsd: steps.reduce((sum, s) => sum + s.message.usage.cost.total, extraUsd),
    };
  });
}

export function summaryOf(id: string, turns: readonly Turn[], fallbackAt: number): ThreadSummary {
  const first = turns[0];
  const last = turns.at(-1);
  return {
    id,
    title: first?.question ?? "",
    view: first?.view ?? "",
    startedAt: first?.askedAt ?? fallbackAt,
    updatedAt: last ? last.askedAt + last.tookMs : fallbackAt,
    questions: turns.length,
    costUsd: turns.reduce((sum, t) => sum + t.costUsd, 0),
    spend: turns.map(t => ({ at: t.askedAt, costUsd: t.costUsd })),
  };
}
