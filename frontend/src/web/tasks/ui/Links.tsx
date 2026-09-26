import { cn } from "cn";
import { GitPullRequest, Link2, Ticket, Video, CircleDot, type LucideIcon } from "lucide-react";
import type { TaskLink } from "@/shared/tasks";

export const LINK_ICON: Record<TaskLink["kind"], LucideIcon> = { linear: Ticket, pr: GitPullRequest, issue: CircleDot, jam: Video, url: Link2 };

export const linkLabel = (l: TaskLink): string => {
  switch (l.kind) {
    case "linear":
      return l.id;
    case "pr":
    case "issue":
      return `#${l.number}`;
    case "jam":
      return l.id;
    case "url":
      return l.host;
  }
};

type Group = { key: string; kind: TaskLink["kind"]; prefix: string | null; links: TaskLink[] };

function group(links: readonly TaskLink[]): Group[] {
  const groups: Group[] = [];
  for (const l of links) {
    const repo = l.kind === "pr" || l.kind === "issue" ? l.repo : null;
    const key = `${l.kind}:${repo ?? ""}`;
    const existing = groups.find(g => g.key === key);
    if (existing) existing.links.push(l);
    else groups.push({ key, kind: l.kind, prefix: repo ? (repo.split("/")[1] ?? repo) : null, links: [l] });
  }
  return groups;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function LinkPieces({ links, className, showRepo = true }: { links: readonly TaskLink[]; className?: string; showRepo?: boolean }) {
  if (links.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]", className)}>
      {group(links).map(g => {
        const Icon = LINK_ICON[g.kind];
        return (
          <span key={g.key} className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <Icon aria-hidden className="size-3 shrink-0 text-link" />
            {showRepo && g.prefix && <span className="text-dim">{g.prefix}</span>}
            {g.links.map(l => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" onClick={stop} onPointerDown={stop} className="text-link no-underline hover:underline" title={l.url}>
                {linkLabel(l)}
              </a>
            ))}
          </span>
        );
      })}
    </div>
  );
}
