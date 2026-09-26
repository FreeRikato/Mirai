export type RankingSnapshot<I> =
  | { kind: "unranked" }
  | { kind: "ready"; items: I[]; more: number; unranked: number; rankedAt: number; costUsd: number }
  | { kind: "unavailable"; reason: string };
