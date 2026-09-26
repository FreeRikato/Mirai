import { cn } from "cn";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AsrProgress, Chapter, Highlight, LaterItem, Segment, Transcript } from "@/shared/later";
import { useHighlightActions, useHighlights, useRetryTranscript } from "./api";
import { clockTime } from "./derive";
import { useLaterUi, type WatchTab } from "./store";

export const NOTE_INPUT_ID = "watch-note";

function Chapters({ chapters, current, time, playing, onSeek }: { chapters: readonly Chapter[]; current: Chapter | null; time: number; playing: boolean; onSeek: (sec: number) => void }) {
  if (chapters.length === 0) return <p className="m-0 px-2.5 py-3 text-[10px] text-dim">this video has no chapters on YouTube</p>;
  return (
    <ol aria-label="chapters" className="m-0 flex list-none flex-col p-0">
      {chapters.map(c => {
        const on = current?.at === c.at;
        const past = !on && c.at < time;
        return (
          <li key={c.at}>
            <button
              type="button"
              onClick={() => onSeek(c.at)}
              aria-current={on || undefined}
              className={cn("flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-2.5 py-1.5 text-left font-mono", on ? "bg-lift shadow-[inset_2px_0_0_var(--color-fg)]" : "hover:bg-hover")}
            >
              <span className="w-12 shrink-0 text-[10px] text-dim">{clockTime(c.at)}</span>
              <span className={cn("min-w-0 flex-1 font-serif text-[14px]", past ? "text-dim" : "text-fg")}>{c.title}</span>
              {on && <span className="text-[10px]">{playing ? "playing" : "here"}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function currentLine(segments: readonly Segment[], time: number): number {
  let at = -1;
  for (const [i, s] of segments.entries()) {
    if (s.start > time) break;
    at = i;
  }
  return at;
}

function Lines({ segments, time, playing, onSeek }: { segments: readonly Segment[]; time: number; playing: boolean; onSeek: (sec: number) => void }) {
  const list = useRef<HTMLOListElement>(null);
  const current = currentLine(segments, time);
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>("[aria-current]");
    if (!box || !row) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top - box.clientHeight / 3;
  }, [current]);
  if (segments.length === 0) return <p className="m-0 px-2.5 py-3 text-[10px] text-dim">no speech was found in this video</p>;
  return (
    <ol ref={list} aria-label="transcript" className="m-0 flex max-h-[28rem] list-none flex-col overflow-y-auto p-0">
      {segments.map((s, i) => {
        const on = i === current;
        return (
          <li key={s.start}>
            <button
              type="button"
              onClick={() => onSeek(s.start)}
              aria-current={on || undefined}
              className={cn("flex w-full cursor-pointer items-start gap-3.5 border-0 bg-transparent px-2.5 py-1.5 text-left font-mono", on ? "bg-lift shadow-[inset_2px_0_0_var(--color-fg)]" : "hover:bg-hover")}
            >
              <span className={cn("w-12 shrink-0 pt-0.5 text-[10px]", on ? "text-fg" : "text-dim")}>{clockTime(s.start)}</span>
              <span className={cn("min-w-0 flex-1 font-serif text-[14px]", i < current ? "text-dim" : "text-fg")}>{s.text}</span>
              {on && <span className="shrink-0 pt-0.5 text-[10px]">{playing ? "playing" : "here"}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const STAGE_SHARE: Record<AsrProgress["stage"], { from: number; size: number }> = { downloading: { from: 0, size: 20 }, transcribing: { from: 20, size: 80 } };

function stageLabel(p: AsrProgress): string {
  const pct = `${Math.round((100 * p.done) / Math.max(1, p.total))}%`;
  if (p.stage === "downloading") return `downloading audio ${pct}`;
  return `transcribing ${clockTime(p.done)} of ${clockTime(p.total)}`;
}

function TranscribeProgress({ progress }: { progress: AsrProgress | null }) {
  const share = progress ? STAGE_SHARE[progress.stage] : null;
  const value = progress && share ? Math.round(share.from + (share.size * Math.min(progress.done, progress.total)) / Math.max(1, progress.total)) : 0;
  return (
    <div className="flex items-center gap-3 px-2.5 py-2 text-[10px]">
      <span className="w-56 shrink-0 text-soft">{progress ? stageLabel(progress) : "starting"}</span>
      <div role="progressbar" aria-label="transcription progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-0.5 min-w-0 flex-1 bg-track">
        <div className="h-full bg-fg" style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-dim">{value}%</span>
    </div>
  );
}

function TranscriptPanel({ itemId, transcript, time, playing, onSeek }: { itemId: string; transcript: Transcript | undefined; time: number; playing: boolean; onSeek: (sec: number) => void }) {
  const retry = useRetryTranscript(itemId);
  const note = (text: string) => <p className="m-0 px-2.5 py-3 text-[10px] text-dim">{text}</p>;
  switch (transcript?.status) {
    case undefined:
      return note("loading the transcript");
    case "unsupported":
      return note("transcripts are only made for youtube videos, on a hub with MIRAI_ASR_BIN set");
    case "queued":
      return note("waiting to be transcribed, this usually takes a minute or two");
    case "running":
      return (
        <div className="flex flex-col gap-1">
          <TranscribeProgress progress={transcript.progress} />
          {transcript.segments.length > 0 && <Lines segments={transcript.segments} time={time} playing={playing} onSeek={onSeek} />}
        </div>
      );
    case "failed":
      return (
        <div className="flex items-baseline gap-3 px-2.5 py-3 text-[10px]">
          <span className="min-w-0 flex-1 text-bad">transcribing failed: {transcript.error}</span>
          {transcript.retryAt === null ? (
            <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending} className="cursor-pointer border border-rule bg-transparent px-2 py-0.5 font-mono text-[10px] text-fg hover:border-dim">
              retry
            </button>
          ) : (
            <span className="text-dim">trying again at {new Date(transcript.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
      );
    case "ready":
      return <Lines segments={transcript.segments} time={time} playing={playing} onSeek={onSeek} />;
  }
}

function Notes({ itemId, notes, stamp, onSeek }: { itemId: string; notes: readonly Highlight[]; stamp: () => number; onSeek: (sec: number) => void }) {
  const { add, remove } = useHighlightActions(itemId);
  const [draft, setDraft] = useState("");
  const [at, setAt] = useState<number | null>(null);
  const save = () => {
    const note = draft.trim();
    if (!note) return;
    const sec = at ?? stamp();
    add.mutate({ quote: clockTime(sec), prefix: "", suffix: "", note, at: sec });
    setDraft("");
    setAt(null);
  };
  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
        className="flex items-center gap-3 border border-rule px-2.5 py-1.5 focus-within:border-dim"
      >
        <span className="w-12 shrink-0 text-[10px] text-dim">{at === null ? "now" : clockTime(at)}</span>
        <input
          id={NOTE_INPUT_ID}
          aria-label="note at this moment"
          value={draft}
          onFocus={() => setAt(stamp())}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === "Escape" && e.currentTarget.blur()}
          placeholder="note at this moment, enter to save"
          className="min-w-0 flex-1 border-0 bg-transparent font-serif text-[14px] text-fg outline-none placeholder:text-faint"
        />
      </form>
      {add.isError && <span className="text-[10px] text-bad">{add.error.message}</span>}
      <ol aria-label="notes" className="m-0 flex list-none flex-col p-0">
        {notes.map(n => (
          <li key={n.id} className="group flex items-start gap-3.5 px-2.5 py-1.5 hover:bg-hover">
            <button type="button" aria-label={`play from ${n.quote}`} onClick={() => n.at !== null && onSeek(n.at)} className="w-12 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-[10px] text-dim hover:text-fg">
              {n.at === null ? n.quote : clockTime(n.at)}
            </button>
            <span className="min-w-0 flex-1 font-serif text-[14px] whitespace-pre-wrap">{n.note}</span>
            <button type="button" aria-label={`delete note at ${n.quote}`} onClick={() => remove.mutate(n.id)} className="cursor-pointer border-0 bg-transparent p-0 text-faint opacity-0 group-hover:opacity-100 hover:text-bad focus:opacity-100">
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WatchTabs({ item, chapter, transcript, time, playing, stamp, onSeek }: { item: LaterItem; chapter: Chapter | null; transcript: Transcript | undefined; time: number; playing: boolean; stamp: () => number; onSeek: (sec: number) => void }) {
  const tab = useLaterUi(s => s.watchTab);
  const setTab = useLaterUi(s => s.setWatchTab);
  const notes = [...(useHighlights(item.id).data ?? [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const tabs: { id: WatchTab; label: string }[] = [
    { id: "chapters", label: item.chapters.length > 0 ? `chapters ${item.chapters.length}` : "chapters" },
    ...(item.embed.type === "youtube" ? [{ id: "transcript" as const, label: "transcript" }] : []),
    { id: "notes", label: notes.length > 0 ? `notes ${notes.length}` : "notes" },
  ];
  const shown = tabs.some(t => t.id === tab) ? tab : "chapters";
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="about this video" className="flex gap-6 border-b border-rule">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={shown === t.id}
            onClick={() => setTab(t.id)}
            className={cn("-mb-px cursor-pointer border-0 border-b bg-transparent px-0 pb-2 font-mono text-[11px]", shown === t.id ? "border-fg text-fg" : "border-transparent text-dim hover:text-fg")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {shown === "chapters" && <Chapters chapters={item.chapters} current={chapter} time={time} playing={playing} onSeek={onSeek} />}
        {shown === "transcript" && <TranscriptPanel itemId={item.id} transcript={transcript} time={time} playing={playing} onSeek={onSeek} />}
        {shown === "notes" && <Notes itemId={item.id} notes={notes} stamp={stamp} onSeek={onSeek} />}
      </div>
    </div>
  );
}
