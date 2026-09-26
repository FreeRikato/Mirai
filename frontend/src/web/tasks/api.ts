import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { GithubMove, GithubSnapshot, LinearMove, LinearSnapshot, LocalBlockEdit, LocalMove, LocalSnapshot, LocalState, PrioritySnapshot, TaskOrder, TaskOrders, TaskSource } from "@/shared/tasks";
import { get, keys, post } from "../api";
import { usePollInterval } from "../hooks";
import { useSettings } from "../settings";

export const useLocalTasks = () => useQuery({ queryKey: keys.tasksLocal, queryFn: () => get<LocalSnapshot>("/api/tasks/local"), staleTime: Infinity });
export const useLinearTasks = () => useQuery({ queryKey: keys.tasksLinear, queryFn: () => get<LinearSnapshot>("/api/tasks/linear"), refetchInterval: usePollInterval() });
export const useGithubTasks = () => useQuery({ queryKey: keys.tasksGithub, queryFn: () => get<GithubSnapshot>("/api/tasks/github"), refetchInterval: usePollInterval() });

export const usePriority = () => useQuery({ queryKey: keys.tasksPriority, queryFn: () => get<PrioritySnapshot>("/api/tasks/priority"), refetchInterval: useSettings().tasks.pollMs });

export function useRefreshPriority() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post("/api/tasks/priority/refresh", {}), onSettled: () => qc.invalidateQueries({ queryKey: keys.tasksPriority }) });
}

function useOptimistic<V, S>(key: QueryKey, path: string, patch: (snapshot: S, vars: V) => S) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => post(path, vars),
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<S>(key);
      if (before !== undefined) qc.setQueryData<S>(key, patch(before, vars));
      return { before };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.before !== undefined) qc.setQueryData(key, ctx.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

const MARK: Record<LocalState, string> = { open: " ", doing: "/", done: "x", dropped: "-" };

export const useMoveLocal = () =>
  useOptimistic<LocalMove, LocalSnapshot>(keys.tasksLocal, "/api/tasks/local/move", (s, m) =>
    s.kind !== "ready"
      ? s
      : { ...s, tasks: s.tasks.map(t => (t.date === m.date && t.line === m.line ? { ...t, state: m.to, raw: t.raw.replace(/\[.\]/, `[${MARK[m.to]}]`) } : t)) },
  );

export const useMoveLinear = () =>
  useOptimistic<LinearMove, LinearSnapshot>(keys.tasksLinear, "/api/tasks/linear/move", (s, m) =>
    s.kind !== "ready" ? s : { ...s, issues: s.issues.map(i => (i.id === m.id ? { ...i, column: m.to } : i)) },
  );

export const useMoveGithub = () =>
  useOptimistic<GithubMove, GithubSnapshot>(keys.tasksGithub, "/api/tasks/github/move", (s, m) =>
    s.kind !== "ready" ? s : { ...s, issues: s.issues.map(i => (i.id === m.id ? { ...i, column: m.to } : i)) },
  );

export const useEditLocalBlock = () => useMutation({ mutationFn: (e: LocalBlockEdit) => post("/api/tasks/local/block", e) });
export const useCreateToday = () => useMutation({ mutationFn: () => post("/api/tasks/local/today", {}) });

const NO_ORDER: readonly string[] = [];

export function useTaskOrder(source: TaskSource): { keys: readonly string[]; save: (keys: string[]) => void } {
  const { data } = useQuery({ queryKey: keys.tasksOrder, queryFn: () => get<TaskOrders>("/api/tasks/order"), staleTime: Infinity });
  const save = useOptimistic<TaskOrder, TaskOrders>(keys.tasksOrder, "/api/tasks/order", (s, o) => ({ ...s, [o.source]: o.keys }));
  return { keys: data?.[source] ?? NO_ORDER, save: k => save.mutate({ source, keys: k }) };
}
