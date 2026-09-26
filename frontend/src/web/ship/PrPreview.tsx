import { cn } from "cn";
import { ChevronDown, ChevronUp, CircleCheck, CircleDot, CircleX, CodeXml, ExternalLink, FileDiff, GitMerge, Link2, Ticket, UserPlus, Users, type LucideIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import type { ShipPr } from "@/shared/ship";
import { extractLinks, linkRefs } from "@/shared/links";
import { ago } from "../format";
import { Drawer, DrawerSection } from "../tasks/ui/Drawer";
import { Markdown } from "../tasks/ui/Markdown";
import { repoName } from "../tasks/github/meta";
import { checkSummary, diffText, STATE_LABEL, stateTone } from "./derive";
import { toneText } from "./tone";
import { usePrBody } from "./api";
import { GithubHtml } from "./GithubHtml";
import type { PanelId } from "../shell/SidePanel";
import { px0Id } from "@/shared/px0";
import { usePx0Sessions, useOpenInPx0 } from "../px0/api";
import { px0Summary } from "../px0/Px0Menu";
import { useUi } from "../store";
import { typing } from "./review/derive";

export function PrPreview(p: {
  pr: ShipPr;
  onClose: () => void;
  onStep?: (by: 1 | -1) => void;
  onRequest: (pr: ShipPr) => void;
  requesting: boolean;
  onCopy: (pr: ShipPr) => void;
  onReview: (pr: ShipPr) => void;
  panel?: PanelId;
}) {
  const { onStep } = p;
  const { pr } = p;
  const name = `${repoName(pr.repo)} #${pr.number}`;
  const px0 = usePx0(pr, name);
  return (
    <Drawer title={name} onClose={p.onClose} panel={p.panel ?? "ship-preview"}>
      <DrawerSection className="pr-12">
        <span className="flex items-center gap-3 text-[10px]">
          <a href={pr.url} target="_blank" rel="noreferrer" data-external className="flex items-center gap-1.5 text-dim no-underline hover:text-fg">
            {name}
            <ExternalLink aria-hidden className="size-3" />
          </a>
          {onStep && (
            <span className="flex items-center gap-1">
              <IconButton icon={ChevronUp} label="previous pull request" onClick={() => onStep(-1)} />
              <IconButton icon={ChevronDown} label="next pull request" onClick={() => onStep(1)} />
            </span>
          )}
        </span>
        <h2 className="m-0 text-[14px] leading-[1.4] font-semibold break-words">{pr.title}</h2>
        <span className="text-[10px] break-all text-dim">
          {pr.author} · {pr.head} → {pr.base} · {ago(pr.updatedAt)}
        </span>
      </DrawerSection>
      <Relation {...p} />
      <ShipCheck pr={pr} />
      <Files pr={pr} />
      <DrawerSection>
        <span className="text-[12px] font-semibold">description</span>
        <Description pr={pr} />
      </DrawerSection>
      <div className="sticky bottom-0 mt-auto border-t border-rule bg-bg">
        <Px0Line px0={px0} />
        <div className="flex gap-1.5 px-5 py-2">
          <button type="button" aria-label="copy link" title="copy link" onClick={() => p.onCopy(pr)} className={cn(action, "w-6 border border-rule text-fg hover:border-fg")}>
            <Link2 aria-hidden className="size-3" />
          </button>
          <a href={pr.url} target="_blank" rel="noreferrer" data-external aria-label="github" title="open on github" className={cn(action, "w-6 border border-rule text-fg no-underline hover:border-fg")}>
            <ExternalLink aria-hidden className="size-3" />
          </a>
          <Px0Button px0={px0} />
          <button type="button" onClick={() => p.onReview(pr)} className={cn(action, "border-0 bg-fg px-2.5 text-bg")}>
            <FileDiff aria-hidden className="size-3" />
            review files
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function usePx0(pr: ShipPr, name: string) {
  const px0 = useOpenInPx0();
  const session = usePx0Sessions().data?.sessions.find(s => s.id === px0Id(pr.repo, pr.number)) ?? null;
  const open = () => !px0.pending && px0.open({ repo: pr.repo, number: pr.number }, name);
  return { ...px0, session, open };
}

type Px0State = ReturnType<typeof usePx0>;

function Px0Button({ px0: { open, pending } }: { px0: Px0State }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "p" || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || useUi.getState().paletteOpen) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <button type="button" disabled={pending} aria-keyshortcuts="p" onClick={open} className={cn(action, "ml-auto border border-fg px-2 text-fg disabled:cursor-default disabled:opacity-60")}>
      <CodeXml aria-hidden className="size-3" />
      open in px0
    </button>
  );
}

function Px0Line({ px0: { session, pending, error } }: { px0: Px0State }) {
  const text = error ?? (pending || session?.ready === false ? "starting on the hub, a repository's first open takes longest" : session ? px0Summary(session) : null);
  if (!text) return null;
  return (
    <p role="status" className={cn("m-0 flex items-center gap-2 border-b border-rule px-5 py-1.5 text-[10px]", error ? "text-bad" : "text-dim")}>
      <span className={cn("size-1.5 shrink-0 rounded-full", error ? "bg-bad" : session?.ready ? "bg-ok" : "bg-dim")} />
      <span className="shrink-0 text-fg">px0</span>
      <span className="truncate" title={text}>
        {text}
      </span>
    </p>
  );
}

const action = "flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1.5 bg-transparent font-mono text-[10px] whitespace-nowrap";

function IconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="cursor-pointer border-0 bg-transparent p-0.5 text-dim hover:text-fg">
      <Icon aria-hidden className="size-3" />
    </button>
  );
}

function Relation({ pr, onRequest, requesting }: { pr: ShipPr; onRequest: (pr: ShipPr) => void; requesting: boolean }) {
  if (pr.relation === "author") return null;
  if (pr.relation === "none") {
    return (
      <DrawerSection>
        <button
          type="button"
          disabled={requesting}
          onClick={() => onRequest(pr)}
          className="flex h-[34px] cursor-pointer items-center justify-center gap-2 border-0 bg-fg font-mono text-[11px] text-bg disabled:cursor-default disabled:opacity-60"
        >
          <UserPlus aria-hidden className="size-3.5" />
          {requesting ? "requesting" : "request me as reviewer"}
        </button>
        <span className="text-[9px] text-dim">adds you on github and moves it to waiting on you</span>
      </DrawerSection>
    );
  }
  const text = {
    requested: "your review is requested",
    rereview: `${pr.newCommits} new ${pr.newCommits === 1 ? "commit" : "commits"} since your review`,
    reviewed: "you reviewed this, nothing new since",
  }[pr.relation];
  return (
    <DrawerSection>
      <span className={cn("text-[11px]", pr.relation === "rereview" ? "text-warn" : "text-fg")}>{text}</span>
    </DrawerSection>
  );
}

function Fact({ icon: Icon, tone, label, children }: { icon: LucideIcon; tone: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[10px]">
      <Icon aria-hidden className={cn("mt-px size-3 shrink-0", tone)} />
      <span className="w-[70px] shrink-0 text-dim">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

export function ShipCheck({ pr }: { pr: ShipPr }) {
  const checks = checkSummary(pr);
  const failed = pr.checks.filter(c => c.conclusion === "failed");
  const running = pr.checks.filter(c => c.conclusion === "pending").length;
  const approved = pr.reviews.filter(r => r.state === "approved").map(r => r.login);
  const changes = pr.reviews.filter(r => r.state === "changes").map(r => r.login);
  const tickets = extractLinks(pr.body).links.flatMap(l => (l.kind === "linear" ? [l] : []));

  return (
    <DrawerSection>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">ship check</span>
        <span className={cn("text-[10px]", toneText[stateTone(pr)])}>{STATE_LABEL[pr.state]}</span>
      </div>
      {pr.why !== pr.state && failed.length === 0 && <p className={cn("m-0 text-[10px]", toneText[stateTone(pr)])}>{pr.why}</p>}
      <Fact icon={failed.length ? CircleX : running ? CircleDot : CircleCheck} tone={toneText[checks.tone]} label="checks">
        {checks.text === "–" ? "none ran" : `${checks.text} passed${running ? `, ${running} running` : ""}`}
        {failed.map(c => (
          <a key={c.name} href={c.url ?? pr.url} target="_blank" rel="noreferrer" className="mt-1 flex gap-1.5 text-bad no-underline hover:underline">
            <span aria-hidden>✗</span>
            <span className="min-w-0 break-words">{c.name}</span>
          </a>
        ))}
      </Fact>
      <Fact icon={Users} tone={changes.length ? "text-warn" : approved.length ? "text-ok" : "text-dim"} label="reviews">
        {approved.length > 0 && <span className="block text-ok">approved by {approved.join(", ")}</span>}
        {changes.length > 0 && <span className="block text-warn">changes by {changes.join(", ")}</span>}
        {pr.pending.length > 0 && <span className="block">pending {pr.pending.join(", ")}</span>}
        {approved.length + changes.length + pr.pending.length === 0 && <span className="text-dim">nobody yet</span>}
      </Fact>
      <Fact icon={GitMerge} tone={pr.conflicts ? "text-bad" : "text-ok"} label="conflicts">
        {pr.conflicts ? <span className="text-bad">conflicts with {pr.base}</span> : "none"}
      </Fact>
      {tickets.length > 0 && (
        <Fact icon={Ticket} tone="text-dim" label="linked">
          {tickets.map(t => (
            <a key={t.url} href={t.url} target="_blank" rel="noreferrer" className="mr-2 text-link no-underline hover:underline">
              {t.id}
            </a>
          ))}
        </Fact>
      )}
    </DrawerSection>
  );
}

const shortPath = (path: string) => {
  const parts = path.split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : path;
};

const withoutComments = (markdown: string) => markdown.replace(/<!--[\s\S]*?-->/g, "").trim();

function Description({ pr }: { pr: ShipPr }) {
  const { data } = usePrBody(pr.id);
  if (!pr.body.trim()) return <p className="m-0 text-dim">no description</p>;
  if (data?.kind === "ready") return data.html.trim() ? <GithubHtml html={data.html} /> : <p className="m-0 text-dim">no description</p>;
  if (data?.kind === "unavailable") {
    return (
      <>
        <Markdown>{linkRefs(withoutComments(pr.body), pr.repo)}</Markdown>
        <p className="m-0 text-[10px] text-dim">images need GitHub: {data.reason}</p>
      </>
    );
  }
  return <p className="m-0 text-dim">loading description</p>;
}

function Files({ pr }: { pr: ShipPr }) {
  const more = pr.changedFiles - pr.files.length;
  return (
    <DrawerSection>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">files</span>
        <span className="text-[10px] text-dim">
          {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"} {diffText(pr)}
        </span>
      </div>
      <ul aria-label="changed files" className="m-0 flex list-none flex-col gap-1 p-0">
        {pr.files.map(f => (
          <li key={f.path} className="flex gap-2.5 text-[10px]">
            <span className="min-w-0 flex-1 truncate" title={f.path}>
              {shortPath(f.path)}
            </span>
            <span className="text-ok">+{f.additions}</span>
            <span className="text-bad">−{f.deletions}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <span className="text-[10px] text-dim">+ {more} more</span>}
    </DrawerSection>
  );
}
