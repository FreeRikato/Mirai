import { useQuery } from "@tanstack/react-query";
import type { GithubRef, LinearRef } from "@/shared/refs";
import { get, keys } from "../api";

const REF_STALE_MS = 60_000;

export const useGithubRef = (ref: string) =>
  useQuery({ queryKey: keys.githubRef(ref), queryFn: () => get<GithubRef>(`/api/tasks/github/ref?ref=${encodeURIComponent(ref)}`), staleTime: REF_STALE_MS });

export const useLinearRef = (id: string) =>
  useQuery({ queryKey: keys.linearRef(id), queryFn: () => get<LinearRef>(`/api/tasks/linear/issue?id=${encodeURIComponent(id)}`), staleTime: REF_STALE_MS });
