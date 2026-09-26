import type { GithubColumn, GithubIssue, TaskLink } from "@/shared/tasks";
import type { Glyph } from "../ui/Glyph";

export const githubGlyph: Record<GithubColumn, Glyph> = { open: "open", progress: "doing", closed: "done" };

export const fromLinear = (i: GithubIssue, bot: string) => i.author === bot;

export const who = (i: GithubIssue) => ({ assigned: i.assignedToMe, created: i.createdByMe });

export const pullRequestLinks = (i: GithubIssue): TaskLink[] => i.pullRequests.filter(p => p.state === "open").map(p => ({ kind: "pr", url: p.url, repo: p.repo, number: p.number }));

export const repoName = (repo: string) => repo.split("/")[1] ?? repo;

export function Label({ name, color }: { name: string; color: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-[7px] rounded-full" style={{ background: `#${color}` }} />
      {name}
    </span>
  );
}

