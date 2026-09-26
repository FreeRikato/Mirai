import { z } from "zod";
import { RemoteError } from "./remote";

export type JevQuestion =
  | { type: "score"; instructions: string; criteria: readonly string[] }
  | { type: "choice"; instructions: string; criteria: Readonly<Record<string, string>> };

const AnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("score"), score: z.number(), confidence: z.number() }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number() }),
  z.object({ type: z.literal("noul"), noul: z.number() }),
]);
export type JevAnswer = z.infer<typeof AnswerSchema>;

const ResponseSchema = z.object({ answers: z.record(z.string(), AnswerSchema), usage: z.object({ cost: z.number() }).partial().optional() });
const ErrorSchema = z.object({ error: z.object({ message: z.string() }) });

export type JevResult = { answers: Record<string, JevAnswer>; costUsd: number };
export type Jev = (state: unknown, questions: Readonly<Record<string, JevQuestion>>) => Promise<JevResult>;

export function createJev({ apiKey, url, model, timeoutMs }: { apiKey: string; url: string; model: string; timeoutMs: number }): Jev {
  return async (state, questions) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "x-title": "Mirai" },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = ErrorSchema.safeParse(body);
      throw new RemoteError(`jev answered ${res.status}${err.success ? `: ${err.data.error.message}` : ""}`);
    }
    const parsed = ResponseSchema.parse(body);
    return { answers: parsed.answers, costUsd: parsed.usage?.cost ?? 0 };
  };
}
