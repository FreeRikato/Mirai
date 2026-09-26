import { cn } from "cn";
import { ExternalLink, Eye, NotebookPen } from "lucide-react";
import type { LinearIssue } from "@/shared/tasks";
import type { PanelId } from "../../shell/SidePanel";
import { useLocalTasks } from "../api";
import { Drawer, DrawerSection } from "../ui/Drawer";
import { GlyphIcon } from "../ui/Glyph";
import { LinkPieces } from "../ui/Links";
import { Markdown } from "../ui/Markdown";
import { linearGlyph, PRIORITY } from "./meta";

export function LinearDrawer({ issue, onClose, panel }: { issue: LinearIssue; onClose: () => void; panel?: PanelId }) {
  const P = PRIORITY[issue.priority];
  const mentions = useMentions(issue.identifier);
  const props: [string, React.ReactNode][] = [
    ["status", <><GlyphIcon glyph={linearGlyph[issue.column]} className="size-3" />{issue.stateName}</>],
    ["priority", <><P.icon aria-hidden className={cn("size-3", P.tone)} />{issue.priority}</>],
    ["assignee", issue.assignee ? (issue.assignee.isMe ? "you" : issue.assignee.name) : "nobody"],
    ["creator", issue.creator ? (issue.creator.isMe ? "you" : issue.creator.name) : "unknown"],
    ["team", issue.team.name],
    ...(issue.cycle ? [["cycle", `${issue.cycle.number}, ends ${issue.cycle.endsAt.slice(0, 10)}`] satisfies [string, string]] : []),
  ];

  return (
    <Drawer title={issue.identifier} onClose={onClose} panel={panel}>
      <DrawerSection className="pr-12">
        <span className="flex items-center gap-2">
          <GlyphIcon glyph={linearGlyph[issue.column]} />
          <a href={issue.url} target="_blank" rel="noreferrer" data-external className="flex items-center gap-1.5 text-[12px] font-semibold text-link no-underline hover:underline">
            {issue.identifier}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </span>
        <h2 className="m-0 text-[14px] leading-[1.4] font-semibold">{issue.title}</h2>
      </DrawerSection>
      <DrawerSection>
        <dl className="m-0 grid grid-cols-[80px_1fr] gap-y-2 text-[11px]">
          {props.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[10px] text-dim">{k}</dt>
              <dd className="m-0 flex items-center gap-2">{v}</dd>
            </div>
          ))}
        </dl>
      </DrawerSection>
      <DrawerSection className="border-b-0">
        <span className="flex items-center gap-1.5 text-[10px] text-dim">
          <Eye aria-hidden className="size-3" />
          description
        </span>
        {issue.description ? <Markdown>{issue.description}</Markdown> : <p className="m-0 text-dim">no description</p>}
        {issue.links.length > 0 && (
          <>
            <span className="pt-2 text-[10px] text-dim">links</span>
            <LinkPieces links={issue.links} className="text-[11px]" />
          </>
        )}
        {mentions.map(m => (
          <span key={m} className="flex items-center gap-2 pt-1 text-[10px] text-dim">
            <NotebookPen aria-hidden className="size-3" />
            also in {m}
          </span>
        ))}
      </DrawerSection>
    </Drawer>
  );
}

function useMentions(identifier: string): string[] {
  const { data } = useLocalTasks();
  if (data?.kind !== "ready") return [];
  return data.tasks.filter(t => t.links.some(l => l.kind === "linear" && l.id === identifier)).map(t => `${t.date}.md, line ${t.line + 1}`);
}
