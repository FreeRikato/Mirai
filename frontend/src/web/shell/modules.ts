export type ModuleId = "machines" | "projects" | "tasks" | "ship" | "later" | "notes" | "stats";

export type ModuleEntry = { id: ModuleId; label: string; href: string | null };

export const MODULES: readonly ModuleEntry[] = [
  { id: "machines", label: "machines", href: "/machines" },
  { id: "projects", label: "projects", href: "/projects" },
  { id: "tasks", label: "tasks", href: "/tasks" },
  { id: "ship", label: "ship", href: "/ship" },
  { id: "later", label: "content", href: "/content" },
  { id: "notes", label: "notes", href: "/notes" },
  { id: "stats", label: "stats", href: "/stats" },
];
