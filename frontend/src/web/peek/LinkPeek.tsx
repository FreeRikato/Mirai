import { peekParam, type Peek } from "@/shared/refs";
import type { ShipPr } from "@/shared/ship";
import { closePeek, navigate, reviewHref, usePeek } from "../router";
import { useRequestMe } from "../ship/api";
import { PrPreview } from "../ship/PrPreview";
import { GithubDrawer } from "../tasks/github/GithubDrawer";
import { repoName } from "../tasks/github/meta";
import { LinearDrawer } from "../tasks/linear/LinearDrawer";
import { Drawer, DrawerSection } from "../tasks/ui/Drawer";
import { useGithubRef, useLinearRef } from "./api";

export function LinkPeek() {
  const peek = usePeek();
  if (!peek) return null;
  return peek.kind === "github" ? <GithubPeek key={peekParam(peek)} peek={peek} /> : <LinearPeek key={peek.id} id={peek.id} />;
}

function GithubPeek({ peek }: { peek: Extract<Peek, { kind: "github" }> }) {
  const { data } = useGithubRef(peekParam(peek));
  if (data?.kind === "pr") return <PrPeek pr={data.pr} />;
  if (data?.kind === "issue") return <GithubDrawer issue={data.issue} onClose={closePeek} panel="peek" />;
  return (
    <Waiting title={`${repoName(peek.repo)} #${peek.number}`} reason={data?.kind === "unavailable" ? data.reason : "asking GitHub"}>
      <a href={`https://github.com/${peek.repo}/issues/${peek.number}`} target="_blank" rel="noreferrer" data-external className="text-[10px] text-link no-underline hover:underline">
        open on github
      </a>
    </Waiting>
  );
}

function PrPeek({ pr }: { pr: ShipPr }) {
  const request = useRequestMe();
  return (
    <PrPreview
      pr={pr}
      panel="peek"
      onClose={closePeek}
      onRequest={p => request.mutate(p.id)}
      requesting={request.isPending}
      onCopy={p => void navigator.clipboard.writeText(p.url)}
      onReview={p => navigate(reviewHref("all", p.id))}
    />
  );
}

function LinearPeek({ id }: { id: string }) {
  const { data } = useLinearRef(id);
  if (data?.kind === "ready") return <LinearDrawer issue={data.issue} onClose={closePeek} panel="peek" />;
  return <Waiting title={id} reason={data?.kind === "unavailable" ? data.reason : "asking Linear"} />;
}

function Waiting({ title, reason, children }: { title: string; reason: string; children?: React.ReactNode }) {
  return (
    <Drawer title={title} onClose={closePeek} panel="peek">
      <DrawerSection className="pr-12">
        <span className="text-[12px] font-semibold">{title}</span>
        <span className="text-[11px] text-dim">{reason}</span>
        {children}
      </DrawerSection>
    </Drawer>
  );
}
