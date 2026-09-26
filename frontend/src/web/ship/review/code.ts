import { useQuery } from "@tanstack/react-query";
import type { CodeTarget, Highlight, TokenLine } from "@/shared/code";
import { get, keys } from "../../api";

export function useTokens(target: CodeTarget, path: string | null, side: "old" | "new"): TokenLine[] | null {
  const query = path === null ? "" : new URLSearchParams({ ...target, path, side }).toString();
  const { data } = useQuery({
    queryKey: keys.codeHighlight(query),
    queryFn: () => get<Highlight>(`/api/code/highlight?${query}`),
    enabled: path !== null,
    staleTime: Infinity,
  });
  return data?.kind === "ready" ? data.lines : null;
}
