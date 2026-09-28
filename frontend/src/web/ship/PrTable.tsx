import { cn } from "cn";
import { UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import type { ShipPr, ShipQueue } from "@/shared/ship";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ago } from "../format";
import { repoName } from "../tasks/github/meta";
import { checkSummary, diffText, reviewSummary, stateTone, type Group } from "./derive";
import { toneDot, toneText } from "./tone";

const th = "h-8 px-2 text-[10px] font-normal text-dim first:pl-5 last:pr-5";
const td = "px-2 py-2 align-middle text-[10px] first:pl-5 last:pr-5";
const wide = "hidden @3xl:table-cell";

type Column = { id: string; label: string; width: string; cell: (pr: ShipPr, ctx: CellContext) => ReactNode };
type CellContext = { onRequest: (pr: ShipPr) => void; requesting: string | null };

const whyCell = (pr: ShipPr) => <span className={cn("block truncate", toneText[stateTone(pr)])}>{pr.why}</span>;
const checksCell = (pr: ShipPr) => {
  const c = checkSummary(pr);
  return <span className={toneText[c.tone]}>{c.text}</span>;
};
const reviewsCell = (pr: ShipPr) => {
  const r = reviewSummary(pr);
  return <span className={toneText[r.tone]}>{r.text}</span>;
};
const authorCell = (pr: ShipPr) => <span className="block truncate text-dim">{pr.author}</span>;
const ageCell = (pr: ShipPr) => <span className="text-dim">{ago(pr.updatedAt)}</span>;
const diffCell = (pr: ShipPr) => <span className="text-dim">{diffText(pr)}</span>;

const reviewWhyCell = (pr: ShipPr) =>
  pr.relation === "rereview" ? <span className="text-warn">{pr.newCommits} new {pr.newCommits === 1 ? "commit" : "commits"}</span> : whyCell(pr);

export function RelationCell({ pr, ctx }: { pr: ShipPr; ctx: CellContext }) {
  if (pr.relation === "none") {
    const busy = ctx.requesting === pr.id;
    return (
      <button
        type="button"
        disabled={busy}
        aria-label={`request me as reviewer on ${repoName(pr.repo)} #${pr.number}`}
        onClick={e => {
          e.stopPropagation();
          ctx.onRequest(pr);
        }}
        className="inline-flex cursor-pointer items-center gap-1 border border-rule bg-transparent px-2 py-0.5 font-mono text-[9px] text-dim hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-50"
      >
        <UserPlus aria-hidden className="size-2.5" />
        request me
      </button>
    );
  }
  const label = { author: "author", requested: "requested", rereview: "re-review", reviewed: "reviewed" }[pr.relation];
  return <span className={pr.relation === "rereview" ? "text-warn" : pr.relation === "requested" ? "text-fg" : "text-dim"}>{label}</span>;
}

const COLUMNS: Record<ShipQueue, Column[]> = {
  mine: [
    { id: "why", label: "why", width: "w-[200px]", cell: whyCell },
    { id: "checks", label: "checks", width: "w-[64px]", cell: checksCell },
    { id: "reviews", label: "reviews", width: "w-[64px]", cell: reviewsCell },
    { id: "diff", label: "diff", width: "w-[96px]", cell: diffCell },
    { id: "age", label: "age", width: "w-[60px]", cell: ageCell },
  ],
  review: [
    { id: "author", label: "author", width: "w-[130px]", cell: authorCell },
    { id: "why", label: "why", width: "w-[180px]", cell: reviewWhyCell },
    { id: "checks", label: "checks", width: "w-[64px]", cell: checksCell },
    { id: "diff", label: "diff", width: "w-[96px]", cell: diffCell },
    { id: "age", label: "age", width: "w-[60px]", cell: ageCell },
  ],
  all: [
    { id: "author", label: "author", width: "w-[130px]", cell: authorCell },
    { id: "you", label: "you", width: "w-[128px]", cell: (pr, ctx) => <RelationCell pr={pr} ctx={ctx} /> },
    { id: "checks", label: "checks", width: "w-[64px]", cell: checksCell },
    { id: "age", label: "age", width: "w-[60px]", cell: ageCell },
  ],
};

export function PrTable({ queue, groups, selected, onSelect, ...ctx }: { queue: ShipQueue; groups: readonly Group[]; selected: string | null; onSelect: (id: string) => void } & CellContext) {
  const columns = COLUMNS[queue];
  return (
    <Table className="table-fixed font-mono" aria-label="pull requests">
      <TableHeader>
        <TableRow className="border-rule hover:bg-transparent">
          <TableHead className={cn(th, "w-[34px]")}>
            <span className="sr-only">state</span>
          </TableHead>
          <TableHead className={th}>pull request</TableHead>
          {columns.map(c => (
            <TableHead key={c.id} className={cn(th, wide, c.width)}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {groups.map(g => (
        <TableBody key={g.id} aria-label={g.label}>
          <TableRow className="border-0 hover:bg-transparent">
            <TableCell className="overflow-visible px-5 pt-3 pb-1.5 whitespace-nowrap">
              <span className={cn("text-[10px] font-semibold", toneText[g.tone])}>{g.label}</span>
              <span className="ml-2 text-[10px] text-dim">{g.prs.length}</span>
            </TableCell>
            <TableCell />
            {columns.map(c => (
              <TableCell key={c.id} className={wide} />
            ))}
          </TableRow>
          {g.prs.map(pr => {
            const on = pr.id === selected;
            return (
              <TableRow
                key={pr.id}
                data-pr={pr.id}
                aria-selected={on}
                onClick={() => onSelect(pr.id)}
                className={cn("cursor-pointer border-rule", on ? "bg-raise shadow-[inset_2px_0_0_var(--color-selection)] hover:bg-raise" : "hover:bg-hover")}
              >
                <TableCell className={cn(td, "w-[34px]")}>
                  <span className={cn("block size-[7px] rounded-full", toneDot[stateTone(pr)])} />
                </TableCell>
                <TableCell className={cn(td, "min-w-0")}>
                  <span className="block truncate text-dim">
                    {repoName(pr.repo)} #{pr.number}
                  </span>
                  <span className={cn("block truncate text-[12px]", pr.draft ? "text-dim" : "text-fg")}>{pr.title}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-2.5 @3xl:hidden">
                    {queue === "all" ? <RelationCell pr={pr} ctx={ctx} /> : <span className="min-w-0 truncate">{(queue === "review" ? reviewWhyCell : whyCell)(pr)}</span>}
                    <span className="shrink-0">{checksCell(pr)}</span>
                    <span className="shrink-0">{ageCell(pr)}</span>
                  </span>
                </TableCell>
                {columns.map(c => (
                  <TableCell key={c.id} className={cn(td, wide, "truncate")}>
                    {c.cell(pr, ctx)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      ))}
    </Table>
  );
}
