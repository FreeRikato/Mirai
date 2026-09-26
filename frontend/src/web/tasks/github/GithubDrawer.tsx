import { ExternalLink, MessageSquare, Ticket } from "lucide-react";
import { linkRefs } from "@/shared/links";
import type { GithubIssue } from "@/shared/tasks";
import type { PanelId } from "../../shell/SidePanel";
import { useSettings } from "../../settings";
import { Drawer, DrawerSection } from "../ui/Drawer";
import { GlyphIcon } from "../ui/Glyph";
import { LinkPieces } from "../ui/Links";
import { Markdown } from "../ui/Markdown";
import { fromLinear, githubGlyph, Label, pullRequestLinks, repoName } from "./meta";

export function GithubDrawer({ issue, onClose, panel }: { issue: GithubIssue; onClose: () => void; panel?: PanelId }) {
  const prs = pullRequestLinks(issue);
  return (
    <Drawer title={`${repoName(issue.repo)} #${issue.number}`} onClose={onClose} panel={panel}>
      <DrawerSection className="pr-12">
        <span className="flex items-center gap-2 text-[11px]">
          <GlyphIcon glyph={githubGlyph[issue.column]} />
          <span className="text-dim">{repoName(issue.repo)}</span>
          <a href={issue.url} target="_blank" rel="noreferrer" data-external className="flex items-center gap-1.5 font-semibold text-link no-underline hover:underline">
            #{issue.number}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </span>
        <h2 className="m-0 text-[14px] leading-[1.4] font-semibold">{issue.title}</h2>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-dim">
          {issue.labels.map(l => (
            <Label key={l.name} {...l} />
          ))}
          {fromLinear(issue, useSettings().tasks.linearGithubBot) && (
            <span className="flex items-center gap-1 text-link">
              <Ticket aria-hidden className="size-3" />
              from linear
            </span>
          )}
          <span className="flex items-center gap-1">
            <MessageSquare aria-hidden className="size-3" />
            {issue.comments}
          </span>
        </span>
      </DrawerSection>
      {prs.length > 0 && (
        <DrawerSection>
          <span className="text-[10px] text-dim">closing pull requests</span>
          <LinkPieces links={prs} className="text-[11px]" />
        </DrawerSection>
      )}
      <DrawerSection className="border-b-0">
        {issue.body.trim() ? <Markdown>{linkRefs(issue.body, issue.repo)}</Markdown> : <p className="m-0 text-dim">no description</p>}
        {issue.links.length > 0 && (
          <>
            <span className="pt-2 text-[10px] text-dim">links</span>
            <LinkPieces links={issue.links} className="text-[11px]" />
          </>
        )}
      </DrawerSection>
    </Drawer>
  );
}
