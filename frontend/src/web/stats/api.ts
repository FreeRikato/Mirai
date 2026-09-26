import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Period, UsageReport } from "@/shared/usage";
import { get, post } from "../api";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const statsKeys = { ai: ["stats", "ai"] as const };

export function useAiUsage(period: Period, hidden: readonly string[]) {
  const q = new URLSearchParams({ period, tz: TZ });
  if (hidden.length) q.set("hide", hidden.join(","));
  return useQuery({
    queryKey: [...statsKeys.ai, period, hidden.join(",")],
    queryFn: () => get<UsageReport>(`/api/stats/ai?${q}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useRefreshAi() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post("/api/stats/ai/refresh", {}), onSettled: () => qc.invalidateQueries({ queryKey: statsKeys.ai }) });
}
