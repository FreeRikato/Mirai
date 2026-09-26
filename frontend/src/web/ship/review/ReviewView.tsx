import { cn } from "cn";
import { ArrowLeft, Palette, Square, SquareCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { Anchor } from "@/shared/diff";
import type { ReviewFile, ReviewThread, ShipQueue, ShipReview } from "@/shared/ship";
import { navigate, shipHref } from "../../router";
import { useUi } from "../../store";
import { Unavailable } from "../../tasks/ui/Layout";
import { useMarkViewed, useReview } from "../api";
import { step } from "../derive";
import { useShipUi } from "../store";
import { useTokens } from "./code";
import { treeOrder, firstToOpen, typing } from "./derive";
import { anchorKey, DiffView } from "./DiffView";
import { useDraft, useDrafts, type DiffMode } from "./draft";
import { FileTree } from "./FileTree";
import { ReviewRail } from "./ReviewRail";

const MODES: readonly DiffMode[] = ["split", "unified"];

export function ReviewView({ queue, id }: { queue: ShipQueue; id: string }) {
  const { data } = useReview(id);
  const back = () => {
    useShipUi.getState().select(id);
    navigate(shipHref(queue));
  };
  if (data?.kind === "ready") return <Ready review={data} onBack={back} />;
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <button type="button" onClick={back} className="flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent px-5 pt-4 font-mono text-[10px] text-dim hover:text-fg">
        <ArrowLeft aria-hidden className="size-3" />
        queue
      </button>
      <Unavailable reason={data?.kind === "unavailable" ? data.reason : "loading the diff from GitHub"} />
    </main>
  );
}

function Ready({ review, onBack }: { review: Extract<ShipReview, { kind: "ready" }>; onBack: () => void }) {
  const { pr, files, threads, headSha, baseSha } = review;
  const target = { repo: pr.repo, head: headSha, base: baseSha };
  const ordered = treeOrder(files);
  const [current, setCurrent] = useState(() => firstToOpen(files));
  const [composing, setComposing] = useState<Anchor | null>(null);
  const [anchorTarget, setAnchorTarget] = useState<string | null>(null);
  const mode = useDrafts(s => s.mode);
  const setMode = useDrafts(s => s.setMode);
  const coloursOn = useDrafts(s => s.colours);
  const setColours = useDrafts(s => s.setColours);
  const pending = useDraft(pr.id).comments;
  const markViewed = useMarkViewed();
  const file = files.find(f => f.path === current) ?? null;
  const oldTokens = useTokens(target, coloursOn && file && file.status !== "added" ? (file.previous ?? file.path) : null, "old");
  const newTokens = useTokens(target, coloursOn && file && file.status !== "removed" ? file.path : null, "new");
  const toggleColours = () => setColours(!coloursOn);

  const open = (path: string | null) => {
    setCurrent(path);
    setComposing(null);
  };
  const move = (by: 1 | -1) => open(step(ordered.map(f => f.path), current, by));
  const toggleViewed = (f: ReviewFile) => markViewed.mutate({ id: pr.id, path: f.path, viewed: !f.viewed });
  const jump = (t: ReviewThread) => {
    open(t.path);
    if (t.line !== null) setAnchorTarget(`${t.path}#${anchorKey({ side: t.side, line: t.line })}`);
  };

  useEffect(() => {
    if (current) document.querySelector(`[data-file="${CSS.escape(current)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  useEffect(() => {
    if (!anchorTarget) return;
    document.querySelector(`[data-anchor="${CSS.escape(anchorTarget)}"]`)?.scrollIntoView({ block: "center" });
    setAnchorTarget(null);
  }, [anchorTarget]);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || useUi.getState().paletteOpen || typing(e.target)) return;
      if (e.key === "n") move(1);
      else if (e.key === "p") move(-1);
      else if (e.key === "u") setMode(mode === "split" ? "unified" : "split");
      else if (e.key === "c") toggleColours();
      else if (e.key === "v" && file) {
        if (!file.viewed) toggleViewed(file);
        move(1);
      } else if (e.key === "Escape") {
        if (composing) setComposing(null);
        else onBack();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <FileTree pr={pr} files={files} threads={threads} pending={pending} current={current} onOpen={open} onViewed={toggleViewed} onBack={onBack} />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-11 shrink-0 items-center gap-3 border-b border-rule px-5 py-2">
          <select
            aria-label="file"
            value={current ?? ""}
            onChange={e => open(e.target.value)}
            className="min-w-0 flex-1 border border-rule bg-bg px-2 py-1 font-mono text-[10px] text-fg md:hidden"
          >
            {ordered.map(f => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
          {file && (
            <span className="hidden min-w-0 flex-1 flex-col md:flex">
              <span className="truncate text-[11px]" title={file.path}>
                {file.path}
              </span>
              {file.previous && <span className="truncate text-[9px] text-dim">renamed from {file.previous}</span>}
            </span>
          )}
          {file && (
            <>
              <span className="text-[10px] text-ok">+{file.additions}</span>
              <span className="text-[10px] text-bad">−{file.deletions}</span>
              <button
                type="button"
                aria-pressed={file.viewed}
                onClick={() => toggleViewed(file)}
                className={cn("flex h-6 cursor-pointer items-center gap-1.5 border bg-transparent px-2 font-mono text-[9px]", file.viewed ? "border-ok text-ok" : "border-rule text-dim hover:text-fg")}
              >
                {file.viewed ? <SquareCheck aria-hidden className="size-3" /> : <Square aria-hidden className="size-3" />}
                viewed
              </button>
            </>
          )}
          <button
            type="button"
            aria-pressed={coloursOn}
            onClick={toggleColours}
            title="syntax colours (c)"
            className={cn("flex h-6 cursor-pointer items-center gap-1.5 border bg-transparent px-2 font-mono text-[9px]", coloursOn ? "border-link text-link" : "border-rule text-dim hover:text-fg")}
          >
            <Palette aria-hidden className="size-3" />
            colours
          </button>
          <div role="radiogroup" aria-label="diff layout" className="flex border border-rule">
            {MODES.map(m => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn("h-6 cursor-pointer border-0 px-2.5 font-mono text-[9px]", mode === m ? "bg-lift text-fg" : "bg-transparent text-dim hover:text-fg")}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div key={current} className="min-h-0 flex-1 overflow-y-auto">
          {file ? (
            <DiffView file={file} mode={mode} prUrl={pr.url} colours={{ old: oldTokens, new: newTokens }} notes={{ prId: pr.id, path: file.path, threads, pending, composing, compose: setComposing }} />
          ) : (
            <Unavailable reason="this pull request changes no files" />
          )}
        </div>
      </main>
      <ReviewRail pr={pr} headSha={headSha} threads={threads} onJump={jump} />
    </>
  );
}
