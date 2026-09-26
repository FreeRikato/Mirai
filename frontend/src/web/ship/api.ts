import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarkViewed, ReadinessSnapshot, ShipBadge, ShipBody, ShipPr, ShipReview, ShipSearch, ShipSnapshot, SubmitReview } from "@/shared/ship";
import { get, keys, post } from "../api";
import { usePollInterval } from "../hooks";
import { useSettings } from "../settings";

export const useShip = () => useQuery({ queryKey: keys.ship, queryFn: () => get<ShipSnapshot>("/api/ship"), refetchInterval: usePollInterval() });

export const useShipBadge = () => useQuery({ queryKey: keys.shipBadge, queryFn: () => get<ShipBadge>("/api/ship/badge"), refetchInterval: usePollInterval() });

export const useReadiness = () => useQuery({ queryKey: keys.shipReadiness, queryFn: () => get<ReadinessSnapshot>("/api/ship/readiness"), refetchInterval: usePollInterval() });

export function useRefreshReadiness() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post("/api/ship/readiness/refresh", {}), onSettled: () => qc.invalidateQueries({ queryKey: keys.shipReadiness }) });
}

const isBody = (b: unknown): b is ShipBody => typeof b === "object" && b !== null && "kind" in b;

const keepRendered = (old: unknown, next: unknown): unknown => (isBody(old) && isBody(next) && old.kind === "ready" && next.kind === "unavailable" ? old : next);

export function usePrBody(id: string) {
  const refreshMs = useSettings().ship.bodyRefreshMs;
  return useQuery({
    queryKey: keys.shipBody(id),
    queryFn: () => get<ShipBody>(`/api/ship/body?id=${encodeURIComponent(id)}`),
    staleTime: refreshMs,
    gcTime: refreshMs,
    refetchInterval: refreshMs,
    structuralSharing: keepRendered,
  });
}

export const useShipSearch = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.shipSearch(q),
    queryFn: () => get<ShipSearch>(`/api/ship/search?q=${encodeURIComponent(q)}`),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

const asRequested = (pr: ShipPr, id: string): ShipPr => (pr.id === id && pr.relation === "none" ? { ...pr, relation: "requested" } : pr);

export function useRequestMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post("/api/ship/request", { id }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: keys.ship });
      qc.setQueriesData<ShipSearch>({ queryKey: ["ship", "search"] }, s => (s?.kind === "ready" ? { ...s, prs: s.prs.map(p => asRequested(p, id)) } : s));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.ship }),
  });
}

export const useReview = (id: string) => useQuery({ queryKey: keys.shipReview(id), queryFn: () => get<ShipReview>(`/api/ship/review?id=${encodeURIComponent(id)}`), staleTime: 60_000 });

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (review: SubmitReview) => post("/api/ship/review", review),
    onSuccess: (_, review) => qc.invalidateQueries({ queryKey: keys.shipReview(review.id) }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: keys.ship, exact: true }), qc.invalidateQueries({ queryKey: keys.shipBadge })]),
  });
}

const withViewed = (review: ShipReview | undefined, { path, viewed }: MarkViewed): ShipReview | undefined =>
  review?.kind === "ready" ? { ...review, files: review.files.map(f => (f.path === path ? { ...f, viewed } : f)) } : review;

export function useMarkViewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mark: MarkViewed) => post("/api/ship/viewed", mark),
    onMutate: (mark: MarkViewed) => {
      const key = keys.shipReview(mark.id);
      const before = qc.getQueryData<ShipReview>(key);
      qc.setQueryData<ShipReview>(key, r => withViewed(r, mark));
      return { before };
    },
    onError: (_, mark, ctx) => qc.setQueryData(keys.shipReview(mark.id), ctx?.before),
  });
}
