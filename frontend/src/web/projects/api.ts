import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ProjectsReport } from "@/shared/projects";
import { get } from "../api";

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => get<ProjectsReport>("/api/projects"), refetchInterval: 10_000, placeholderData: keepPreviousData });
