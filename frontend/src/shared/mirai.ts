import { z } from "zod";

export const THREAD_ID = /^[\w-]{8,64}$/;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const ThreadIdSchema = z.string().regex(THREAD_ID);

export const AskSchema = z.object({
  threadId: ThreadIdSchema.nullable(),
  question: z.string().trim().min(1).max(4000),
  view: z.string().trim().min(1).max(120),
});
export type Ask = z.infer<typeof AskSchema>;

export const ThreadRefSchema = z.object({ threadId: ThreadIdSchema });

const CallSchema = z.object({ id: z.string(), label: z.string(), change: z.boolean(), ok: z.boolean().nullable() });
export type ToolCall = z.infer<typeof CallSchema>;

export const CitationCheckSchema = z.object({ key: z.string(), status: z.enum(["ok", "failed", "unchecked"]), reason: z.string().nullable() });
export type CitationCheck = z.infer<typeof CitationCheckSchema>;

const TurnSchema = z.object({
  question: z.string(),
  view: z.string(),
  askedAt: z.number(),
  tookMs: z.number(),
  thinking: z.string(),
  calls: z.array(CallSchema),
  answer: z.string(),
  status: z.enum(["answering", "done", "stopped", "error"]),
  error: z.string().nullable(),
  costUsd: z.number(),
  citations: z.array(CitationCheckSchema),
});
export type Turn = z.infer<typeof TurnSchema>;

export const ThreadSummarySchema = z.object({
  id: ThreadIdSchema,
  title: z.string(),
  view: z.string(),
  startedAt: z.number(),
  updatedAt: z.number(),
  questions: z.number(),
  costUsd: z.number(),
  spend: z.array(z.object({ at: z.number(), costUsd: z.number() })),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const ThreadSchema = ThreadSummarySchema.extend({ turns: z.array(TurnSchema), busy: z.boolean() });
export type Thread = z.infer<typeof ThreadSchema>;

export const MiraiStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), model: z.string(), thinking: z.enum(THINKING_LEVELS) }),
  z.object({ kind: z.literal("off"), reason: z.string() }),
]);
export type MiraiStatus = z.infer<typeof MiraiStatusSchema>;

export const MiraiEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread"), threadId: ThreadIdSchema }),
  z.object({ type: z.literal("thinking"), delta: z.string() }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("call"), id: z.string(), label: z.string(), change: z.boolean() }),
  z.object({ type: z.literal("call_end"), id: z.string(), ok: z.boolean() }),
  z.object({ type: z.literal("retry"), attempt: z.number(), max: z.number(), delayMs: z.number(), error: z.string() }),
  z.object({ type: z.literal("done"), thread: ThreadSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type MiraiEvent = z.infer<typeof MiraiEventSchema>;

const VIEW_LINE = /^\[view: ([^\]\n]{1,120})\]\n/;

export const withView = (view: string, question: string): string => `[view: ${view.replace(/[\]\n]/g, " ")}]\n${question}`;

export function splitView(text: string): { view: string; question: string } {
  const m = VIEW_LINE.exec(text);
  return m?.[1] ? { view: m[1], question: text.slice(m[0].length) } : { view: "", question: text };
}
