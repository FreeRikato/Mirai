import { useSyncExternalStore } from "react";
import { isLaterKind, type LaterKind } from "@/shared/later";
import { isProjectView, type ProjectView } from "@/shared/projects";
import { parsePeek, peekParam, type Peek } from "@/shared/refs";
import { isShipQueue, type ShipQueue } from "@/shared/ship";
import { isTaskBoard, type TaskBoard } from "@/shared/tasks";

export type Route = { module: "machines"; host: string | null } | { module: "tasks"; board: TaskBoard } | { module: "ship"; queue: ShipQueue; review: string | null } | { module: "later"; view: ContentView } | { module: "notes"; target: string | null } | { module: "stats" } | { module: "projects"; view: ProjectView };

export type ListView = { by: "kind"; kind: LaterKind } | { by: "folder"; folder: string };

export type ContentView = ListView | { by: "item"; id: string };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

if (typeof window !== "undefined") window.addEventListener("popstate", notify);

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): Route {
  const [, mod, sub, rest] = pathname.split("/");
  if (mod === "notes") return { module: "notes", target: decode(pathname.slice("/notes/".length)) || null };
  if (mod === "tasks") return { module: "tasks", board: isTaskBoard(sub) ? sub : "local" };
  if (mod === "ship") return isShipQueue(sub) ? { module: "ship", queue: sub, review: (rest && decode(rest)) || null } : { module: "ship", queue: "mine", review: null };
  if (mod === "stats") return { module: "stats" };
  if (mod === "projects") return { module: "projects", view: isProjectView(sub) ? sub : "stack" };
  if (mod === "content" || mod === "later") {
    if (sub === "item" && rest) return { module: "later", view: { by: "item", id: decode(rest) ?? rest } };
    return { module: "later", view: sub === "folder" && rest ? { by: "folder", folder: decode(rest) ?? rest } : { by: "kind", kind: isLaterKind(sub) ? sub : "read" } };
  }
  return { module: "machines", host: (mod === "machines" && sub && decode(sub)) || null };
}

export const hrefFor = (host: string | null): string => (host ? `/machines/${encodeURIComponent(host)}` : "/machines");
export const tasksHref = (board: TaskBoard): string => (board === "local" ? "/tasks" : `/tasks/${board}`);
export const shipHref = (queue: ShipQueue): string => (queue === "mine" ? "/ship" : `/ship/${queue}`);
export const reviewHref = (queue: ShipQueue, id: string): string => `/ship/${queue}/${encodeURIComponent(id)}`;
export const notesHref = (target: string | null): string => (target ? `/notes/${encodeURIComponent(target)}` : "/notes");
export const projectsHref = (view: ProjectView): string => (view === "stack" ? "/projects" : `/projects/${view}`);
export const laterHref = (kind: LaterKind): string => (kind === "read" ? "/content" : `/content/${kind}`);
export const folderHref = (id: string): string => `/content/folder/${encodeURIComponent(id)}`;
export const contentPath = (pathname: string): string => pathname.replace(/^\/later(?=\/|$)/, "/content");

export function navigate(href: string): void {
  if (href === window.location.pathname || href === window.location.pathname + window.location.search) return;
  window.history.pushState(null, "", href);
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useRoute(): Route {
  return parseRoute(usePathname());
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

export function usePeek(): Peek | null {
  return parsePeek(new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)).get("peek"));
}

export function openPeek(peek: Peek): void {
  window.history.pushState(null, "", `${window.location.pathname}?peek=${peekParam(peek)}`);
  notify();
}

export function closePeek(): void {
  window.history.replaceState(null, "", window.location.pathname);
  notify();
}

export const routeHost = (route: Route): string | null => (route.module === "machines" ? route.host : null);
