import { cn } from "cn";
import { Archive, BookOpen, Check, SkipForward, ExternalLink, RotateCcw, Link, Maximize2, Minimize2, Minus, Play, Plus, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LATER_KINDS, isLaterKind, type LaterFolder, type LaterItem, type LaterKind } from "@/shared/later";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsDesktop } from "../hooks";
import { contentPath, folderHref, laterHref, navigate, useSearch, type ContentView, type ListView } from "../router";
import { useSettings } from "../settings";
import { SidePanel } from "../shell/SidePanel";
import { useUi } from "../store";
import { SidebarSection, Unavailable } from "../tasks/ui/Layout";
import { useFolderActions, useFolders, useLater, usePatch, useProgress, useSaveMany, type SaveOutcome } from "./api";
import { BUDGETS, budgetCounts, extractUrl, extractUrls, folderItems, isStale, matches, kindCounts, LATER_QUEUES, leftLabel, QUEUE_LABEL, queueCounts, siteCounts, placed, step, stepRate, upNext, visible, type Budget, type Side, inQueue, toggledDone } from "./derive";
import { FolderPane, FoldersSection, MovePicker } from "./Folders";
import { LaterList } from "./LaterList";
import { Worth } from "./Worth";
import { OpenWith, SendButton, useSendTo } from "./OpenWith";
import { Player, typing, type Playback } from "./Player";
import { Reader } from "./Reader";
import { FindBar, ReadingLayer, ToolbarTools } from "./ReadingTools";
import { SocialView } from "./SocialView";
import { NOTE_INPUT_ID } from "./WatchTabs";
import { jumpOf, useJump } from "./jump";
import { nextWidth, READER_FACES, READER_WIDTHS, SPEEDS, useLaterUi, viewKey } from "./store";

const KIND_ICON: Record<LaterKind, LucideIcon> = { read: BookOpen, watch: Play };

function useContentPath() {
  useEffect(() => {
    const path = contentPath(window.location.pathname);
    if (path !== window.location.pathname) window.history.replaceState(null, "", path + window.location.search);
  }, []);
}

function saveStatus(pending: number | null, out: SaveOutcome | undefined, error: Error | null): string | null {
  if (pending !== null) return pending === 1 ? "saving and reading the page" : `saving ${pending} links and reading the pages`;
  if (error) return error.message;
  if (!out?.failed.length) return null;
  const failed = out.failed.map(f => `${f.url} (${f.error})`).join(", ");
  return out.saved.length ? `saved ${out.saved.length}, ${out.failed.length} failed: ${failed}` : `could not save ${failed}`;
}

function useShareTarget(save: (url: string) => void) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keys = ["url", "text", "title"];
    if (!keys.some(k => params.has(k))) return;
    const url = extractUrl(keys.map(k => params.get(k) ?? "").join(" "));
    window.history.replaceState(null, "", window.location.pathname);
    if (url) save(url);
  }, [save]);
}

export function LaterView({ view: route }: { view: ContentView }) {
  const { data: items, error } = useLater();
  const { data: folders } = useFolders();
  const folderActions = useFolderActions();
  const ui = useLaterUi();
  const { staleDays } = useSettings().later;
  const desktop = useIsDesktop();
  const mirAIBack = useUi(s => s.mirAIBack);
  const saveMany = useSaveMany();
  const patch = usePatch();
  const [picking, setPicking] = useState(false);
  const progress = useProgress();
  const playback = useRef<Playback | null>(null);
  const filterBox = useRef<HTMLInputElement>(null);
  const [autoplay, setAutoplay] = useState(false);

  const all = items ?? [];
  const cited = route.by === "item" ? (all.find(i => i.id === route.id) ?? null) : null;
  const view: ListView = route.by !== "item" ? route : cited?.folder ? { by: "folder", folder: cited.folder.id } : { by: "kind", kind: cited?.kind ?? ui.lastKind };
  const missing = route.by === "item" && items !== undefined && cited === null;
  const folderId = view.by === "folder" ? view.folder : null;
  const folder = folders?.find(f => f.id === folderId) ?? null;
  const kind = view.by === "kind" ? view.kind : ui.lastKind;
  const key = viewKey(view);
  const filterText = extractUrl(ui.text) ? "" : ui.text;
  const shown = folderId ? folderItems(all, folderId).filter(i => matches(i, filterText)) : visible(all, { kind, queue: ui.queue, budget: ui.budget, site: ui.site, text: filterText });
  const selected = cited?.id ?? ui.selected[key] ?? null;
  const current = all.find(i => i.id === selected && (folderId ? i.folder?.id === folderId : i.folder === null && i.kind === kind)) ?? null;
  const ids = shown.map(i => i.id);

  useEffect(() => {
    if (view.by === "kind") useLaterUi.getState().setLastKind(view.kind);
  }, [view.by, view.by === "kind" ? view.kind : null]);

  const search = useSearch();
  const citeClicks = useUi(s => s.citeClicks);
  const citedId = cited?.id ?? null;
  useEffect(() => {
    if (!citedId) {
      useJump.getState().setJump(null);
      return;
    }
    useLaterUi.getState().select(key, citedId);
    useJump.getState().setJump(jumpOf(citedId, search));
  }, [citedId, key, search, citeClicks]);

  const currentId = current?.id;
  const currentTitle = current?.title;
  const currentKind = current?.kind;
  useEffect(() => {
    useUi.setState({ openContent: currentId && currentTitle !== undefined && currentKind ? { id: currentId, title: currentTitle, kind: currentKind } : null });
    return () => useUi.setState({ openContent: null });
  }, [currentId, currentTitle, currentKind]);

  const { mutate: saveUrls } = saveMany;
  const saveInto = useCallback(
    (urls: readonly string[], into: string | null) =>
      saveUrls(
        { urls, folderId: into },
        {
          onSuccess: out => {
            const first = out.saved[0];
            if (!out.failed.length) useLaterUi.getState().setText("");
            if (!first) return;
            useLaterUi.getState().select(first.folder ? `folder:${first.folder.id}` : first.kind, first.id);
            navigate(first.folder ? folderHref(first.folder.id) : laterHref(first.kind));
          },
        },
      ),
    [saveUrls],
  );
  const saveShared = useCallback((url: string) => saveInto([url], null), [saveInto]);
  useContentPath();
  useShareTarget(saveShared);

  const select = (id: string | null) => {
    setAutoplay(false);
    ui.select(key, id);
    if (route.by === "item") navigate(view.by === "folder" ? folderHref(view.folder) : laterHref(view.kind));
  };
  const move = (by: 1 | -1) => select(step(ids, selected, by));
  const moveTo = (item: LaterItem, into: string | null) => {
    const next = step(ids, item.id, 1);
    folderActions.move.mutate({ id: item.id, folderId: into });
    if ((into ?? null) !== folderId) select(next === item.id ? null : next);
  };
  const place = (id: string, target: string, side: Side) => {
    const order = folderId ? folderItems(all, folderId).map(i => i.id) : ids;
    const next = placed(order, id, target, side);
    if (next.every((n, at) => n === order[at])) return;
    if (folderId) folderActions.reorder.mutate({ folderId, ids: next });
    else folderActions.reorderQueue.mutate(next);
  };
  const reorder = (item: LaterItem, by: 1 | -1) => {
    const order = folderId ? folderItems(all, folderId).map(i => i.id) : ids;
    const target = order[order.indexOf(item.id) + by];
    if (target) place(item.id, target, by === 1 ? "after" : "before");
  };
  const setState = (item: LaterItem, state: LaterItem["state"]) => {
    if (item.folder) return;
    const next = step(ids, item.id, 1);
    patch.mutate({ id: item.id, state });
    if (!inQueue({ ...item, state }, ui.queue)) select(next === item.id ? null : next);
  };
  const onEnded = () => {
    if (!current || !ui.focus) return;
    const next = upNext(all, current, ui.budget).next[0];
    if (!next) return;
    select(next.id);
    setAutoplay(true);
  };
  const onPlayback = useCallback((p: Playback | null) => {
    playback.current = p;
  }, []);
  const send = useSendTo(current);

  useEffect(() => {
    if (selected) document.querySelector(`[data-later="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || useUi.getState().paletteOpen) return;
      if (typing(e.target)) {
        if (e.key === "Escape" && e.target === filterBox.current) {
          ui.setText("");
          filterBox.current?.blur();
        }
        return;
      }
      const pb = playback.current;
      const kindKey = LATER_KINDS[Number(e.key) - 1];
      if (kindKey) navigate(laterHref(kindKey));
      else if (current && (e.key === "J" || e.key === "K")) reorder(current, e.key === "J" ? 1 : -1);
      else if (e.key === "j" || e.key === "ArrowDown") move(1);
      else if (e.key === "k" || e.key === "ArrowUp") move(-1);
      else if (e.key === "/") filterBox.current?.focus();
      else if (e.key === "f" && current) ui.setFocus(!ui.focus);
      else if (e.key === "Escape") ui.focus ? ui.setFocus(false) : select(null);
      else if (current && e.key === "o") window.open(current.url, "_blank", "noopener");
      else if (current && !current.folder && e.key === "e") setState(current, toggledDone(current));
      else if (current && !current.folder && e.key === "#") setState(current, "archived");
      else if (current && e.key === "g") setPicking(!picking);
      else if (current?.folder && e.key === "u") moveTo(current, null);
      else if (current && e.key === "s") send.run();
      else if (pb && e.key === " ") pb.toggle();
      else if (pb && e.key === "ArrowLeft") pb.seekTo(Math.max(0, pb.time() - 10));
      else if (pb && e.key === "ArrowRight") pb.seekTo(pb.time() + 10);
      else if (pb && e.key === "m") pb.setMuted(!pb.muted());
      else if (current?.kind === "watch" && e.key === "c") ui.setCaptions(!ui.captions);
      else if (current?.kind === "watch" && e.key === "n") {
        ui.setWatchTab("notes");
        requestAnimationFrame(() => document.getElementById(NOTE_INPUT_ID)?.focus());
      } else if (e.key === "," || e.key === ".") {
        const next = SPEEDS.find(s => s === stepRate(ui.speed, pb?.rates ?? SPEEDS, e.key === "." ? 1 : -1));
        if (next === undefined) return;
        ui.setSpeed(next);
        pb?.setRate(next);
      } else if (current?.kind === "read" && (e.key === "+" || e.key === "=")) ui.bumpFont(1);
      else if (current?.kind === "read" && e.key === "-") ui.bumpFont(-1);
      else if (current?.kind === "read" && e.key === "w") ui.setWidth(nextWidth(ui.width));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const failed = saveMany.isError || patch.isError || folderActions.move.isError || Boolean(saveMany.data?.failed.length);
  const status = saveStatus(saveMany.isPending ? saveMany.variables.urls.length : null, saveMany.data, saveMany.error) ?? patch.error?.message ?? folderActions.move.error?.message ?? null;
  const nextUp = current?.folder ? (upNext(all, current, null).next[0] ?? null) : null;
  const pane = current ? (
    <Pane
      item={current}
      autoplay={autoplay}
      folders={folders ?? []}
      picking={picking}
      nextUp={nextUp && { item: nextUp, n: folderItems(all, nextUp.folder?.id ?? "").indexOf(nextUp) + 1 }}
      onPicking={setPicking}
      onMove={into => moveTo(current, into)}
      onNext={id => select(id)}
      onState={s => setState(current, s)}
      onProgress={(p, pos) => void progress(current.id, p, pos)}
      onEnded={onEnded}
      onPlayback={onPlayback}
    />
  ) : null;
  const leaveFolder = () => navigate(laterHref(ui.lastKind));
  const list = folder ? (
    <FolderPane folder={folder} items={shown} selected={selected} loading={!items} onSelect={select} onDeleted={leaveFolder} onPlace={place} />
  ) : folderId ? (
    <Unavailable reason={folders ? "this folder no longer exists" : "loading"} />
  ) : (
    <LaterList items={shown} kind={kind} selected={selected} staleDays={staleDays} loading={!items} onSelect={select} onPlace={place} />
  );

  if (error) return <Unavailable reason={`cannot load content: ${error.message}`} />;

  if (ui.focus && current) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <FocusBar kind={kind} folder={folder} item={current} />
        <div className="flex min-h-0 flex-1">
          {desktop && <UpNext items={all} current={current} budget={ui.budget} onPick={id => select(id)} />}
          {pane}
        </div>
      </main>
    );
  }

  return (
    <>
      <SidePanel id="later-sidebar" label="later sidebar" className="hidden md:flex">
        <Sidebar items={all} folders={folders ?? []} view={view} kind={kind} staleDays={staleDays} onArchive={ids => ids.forEach(id => patch.mutate({ id, state: "archived" }))} />
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-2 md:flex-nowrap md:px-5">
          <KindSwitch kind={view.by === "kind" ? kind : null} counts={kindCounts(all)} />
          <label className="flex h-7 min-w-0 flex-1 items-center gap-2 border border-fg px-2.5">
            <Link aria-hidden className="size-3 shrink-0" />
            <input
              ref={filterBox}
              aria-label="paste links to save, or type to filter"
              value={ui.text}
              onChange={e => ui.setText(e.target.value)}
              onKeyDown={e => {
                const urls = extractUrls(ui.text);
                if (e.key === "Enter" && urls.length) saveInto(urls, folderId);
              }}
              placeholder={folder ? `paste links to save into ${folder.name}, or type to filter` : "paste links to save, or type to filter"}
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-dim"
            />
            <span className="hidden font-key text-[10px] text-dim md:inline">{extractUrls(ui.text).length > 1 ? `↵ save ${extractUrls(ui.text).length}` : extractUrl(ui.text) ? "↵ save" : "/"}</span>
          </label>
          {status && (
            <span className={cn("max-w-[320px] truncate text-[10px]", failed ? "text-bad" : "text-dim")} title={status}>
              {status}
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          {desktop ? (
            <>
              <SidePanel id="later-list" label="later list" className="flex">
                {list}
              </SidePanel>
              {pane ?? <Unavailable reason={missing ? "that item was removed" : shown.length ? "pick something from the list, or press j" : ""} />}
            </>
          ) : current ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <button type="button" onClick={() => select(null)} className="cursor-pointer border-0 border-b border-rule bg-transparent px-4 py-2 text-left font-mono text-[11px] text-dim">
                back to list
              </button>
              {mirAIBack && (
                <button type="button" onClick={() => useUi.getState().setMirAIOpen(true)} className="flex cursor-pointer items-center justify-between border-0 border-b border-rule bg-transparent px-4 py-2 font-mono text-[11px] text-dim">
                  <span>from mirAI · back to the thread</span>
                  <span className="text-fg">↩</span>
                </button>
              )}
              {pane}
            </div>
          ) : missing ? (
            <Unavailable reason="that item was removed" />
          ) : (
            list
          )}
        </div>
        <div className="hidden shrink-0 flex-wrap gap-x-[18px] gap-y-1 border-t border-rule px-5 py-2 text-[9px] whitespace-nowrap text-dim md:flex">
          {[...(folderId ? ["j k move", "J K reorder", "g move", "u ungroup", "o open original"] : ["j k move", "J K reorder", "o open original", current?.state === "done" ? "e unread" : "e done", "# archive", "g folder"]), "s send", "f focus", "/ filter", "1 2 read watch", ...((current?.kind ?? kind) === "watch" ? ["space play", "← → 10s", ", . speed", "m mute", "c captions", "n note"] : ["+ - text size", "w width"])].map(k => (
            <span key={k}>{k}</span>
          ))}
        </div>
      </main>
    </>
  );
}

function KindSwitch({ kind, counts }: { kind: LaterKind | null; counts: Record<LaterKind, number> }) {
  return (
    <ToggleGroup type="single" value={kind ?? ""} onValueChange={v => isLaterKind(v) && navigate(laterHref(v))} aria-label="read or watch" className="border border-fg">
      {LATER_KINDS.map(k => {
        const Icon = KIND_ICON[k];
        return (
          <ToggleGroupItem key={k} value={k} className="h-[26px] cursor-pointer gap-1.5 px-3 font-mono text-[11px] text-dim hover:text-fg data-[state=on]:bg-fg data-[state=on]:font-semibold data-[state=on]:text-bg">
            <Icon aria-hidden className="size-3" />
            {k}
            <span className="text-[10px] font-normal">{counts[k]}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function Row({ active, onClick, label, count, dim, disabled }: { active: boolean; onClick: () => void; label: string; count: number | string; dim?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn("-mx-2 flex cursor-pointer items-center justify-between border-0 bg-transparent px-2 py-1 font-mono text-[11px] disabled:cursor-default", active ? "bg-lift text-fg shadow-[inset_2px_0_0_var(--color-fg)]" : cn("hover:bg-hover", dim ? "text-dim" : "text-soft"))}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="text-[10px] text-dim">{count}</span>
    </button>
  );
}

function Sidebar({ items, folders, view, kind, staleDays, onArchive }: { items: readonly LaterItem[]; folders: readonly LaterFolder[]; view: ContentView; kind: LaterKind; staleDays: number; onArchive: (ids: string[]) => void }) {
  const ui = useLaterUi();
  const inFolder = view.by === "folder";
  const back = (apply: () => void) => () => {
    apply();
    if (inFolder) navigate(laterHref(kind));
  };
  const counts = queueCounts(items, kind);
  const budgets = budgetCounts(items, kind, ui.queue);
  const sites = siteCounts(items, kind, ui.queue).slice(0, 8);
  const now = Date.now();
  const stale = items.filter(i => i.kind === kind && isStale(i, now, staleDays));
  const skippable = items.filter(i => i.kind === kind && inQueue(i, "queue") && i.worth === "archive" && !isStale(i, now, staleDays));
  const letGo = [...stale, ...skippable];
  const budgetLabel = (b: Budget) => (b === null ? "any" : b === 60 ? "≤ 1 hour" : `≤ ${b} min`);

  return (
    <>
      <FoldersSection folders={folders} items={items} active={inFolder ? view.folder : null} />
      {!inFolder && <Worth kind={kind} />}
      <div className={cn("flex flex-col", inFolder && "opacity-50")}>
        <SidebarSection title="ungrouped">
          {LATER_QUEUES.map(q => (
            <Row key={q} label={QUEUE_LABEL[q]} count={counts[q]} active={!inFolder && ui.queue === q} onClick={back(() => ui.setQueue(q))} />
          ))}
        </SidebarSection>
        <SidebarSection title="time budget" right="time left">
          {[...BUDGETS, null].map(b => (
            <Row key={String(b)} label={budgetLabel(b)} count={budgets[String(b ?? "all")] ?? 0} active={!inFolder && ui.budget === b} onClick={back(() => ui.setBudget(b))} />
          ))}
        </SidebarSection>
        {sites.length > 0 && (
          <SidebarSection title="sources">
            {sites.map(([site, n]) => (
              <Row key={site} label={site} count={n} active={!inFolder && ui.site === site} onClick={back(() => ui.setSite(ui.site === site ? null : site))} />
            ))}
          </SidebarSection>
        )}
      </div>
      {!inFolder && letGo.length > 0 && (
        <SidebarSection title="still want these?">
          {stale.length > 0 && (
            <span className="text-[10px] text-dim">
              {stale.length} unread for over {staleDays} days
            </span>
          )}
          {skippable.length > 0 && <span className="text-[10px] text-dim">{skippable.length} jev says to archive</span>}
          <button type="button" onClick={() => onArchive(letGo.map(i => i.id))} className="w-fit cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-warn underline">
            archive all {letGo.length}
          </button>
        </SidebarSection>
      )}
      <div className="mt-auto flex items-center gap-2 border-t border-rule px-5 py-3 text-[10px] text-dim">
        <span className="size-[7px] rounded-full bg-ok" />
        paste, ⌘K or share sheet
      </div>
    </>
  );
}

type FolderControls = { folders: readonly LaterFolder[]; picking: boolean; nextUp: { item: LaterItem; n: number } | null; onPicking: (open: boolean) => void; onMove: (folderId: string | null) => void; onNext: (id: string) => void };

function Pane({ item, autoplay, onState, onProgress, onEnded, onPlayback, ...folder }: { item: LaterItem; autoplay: boolean; onState: (s: LaterItem["state"]) => void; onProgress: (progress: number, position: number) => void; onEnded: () => void; onPlayback: (p: Playback | null) => void } & FolderControls) {
  const external = item.embed.type === "external" ? item.embed.reason : null;
  const readable = item.kind === "read" && (item.embed.type === "article" || item.embed.type === "social");
  return (
    <section aria-label={item.title} className="flex min-w-0 flex-1 flex-col">
      {item.kind === "read" && !external && (
        <div aria-hidden className="h-0.5 shrink-0 bg-track">
          <div className="h-full bg-fg" style={{ width: `${Math.round(item.progress * 100)}%` }} />
        </div>
      )}
      <Controls item={item} onState={onState} {...folder} />
      {readable && <FindBar />}
      {readable && <ReadingLayer key={item.id} item={item} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {item.embed.type === "social" ? (
          <SocialView key={item.id} item={item} />
        ) : external ? (
          <OpenWith item={item} reason={external} />
        ) : item.kind === "read" ? (
          <Reader key={item.id} item={item} onProgress={onProgress} />
        ) : (
          <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-5 py-5">
            <Player item={item} autoplay={autoplay} onProgress={onProgress} onEnded={onEnded} onPlayback={onPlayback} />
          </div>
        )}
      </div>
    </section>
  );
}

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick} className={cn("cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px]", on ? "text-fg" : "text-dim hover:text-soft")}>
      {children}
    </button>
  );
}

function ActionButton({ icon: Icon, label, onClick, href, text }: { icon: LucideIcon; label: string; onClick?: () => void; href?: string; text?: string }) {
  const cls = "flex h-6 cursor-pointer items-center gap-1.5 border border-rule bg-transparent px-2 font-mono text-[10px] text-dim no-underline hover:border-dim hover:text-fg";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" data-external aria-label={label} title={label} className={cls}>
      <Icon aria-hidden className="size-3" />
      {text}
    </a>
  ) : (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cls}>
      <Icon aria-hidden className="size-3" />
      {text}
    </button>
  );
}

function Controls({ item, onState, folders, picking, nextUp, onPicking, onMove, onNext }: { item: LaterItem; onState: (s: LaterItem["state"]) => void } & FolderControls) {
  const ui = useLaterUi();
  const read = item.kind === "read" && item.embed.type === "article";
  const readable = item.kind === "read" && (item.embed.type === "article" || item.embed.type === "social");
  const left = leftLabel(item);
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-1.5 md:px-5">
      {readable && (
        <>
          <span className="flex items-center gap-2 text-[10px] text-dim">
            Aa
            <button type="button" aria-label="smaller text" onClick={() => ui.bumpFont(-1)} className="cursor-pointer border-0 bg-transparent p-0 text-dim hover:text-fg">
              <Minus className="size-3" />
            </button>
            <span className="text-fg">{ui.fontSize}px</span>
            <button type="button" aria-label="larger text" onClick={() => ui.bumpFont(1)} className="cursor-pointer border-0 bg-transparent p-0 text-dim hover:text-fg">
              <Plus className="size-3" />
            </button>
          </span>
          <ToolbarTools item={item} />
        </>
      )}
      {readable && (
        <span className="hidden items-center gap-2 md:flex">
          {READER_WIDTHS.map(w => (
            <Chip key={w} on={ui.width === w} onClick={() => ui.setWidth(w)}>
              {w}
            </Chip>
          ))}
        </span>
      )}
      {read && (
        <>
          <span className="hidden items-center gap-2 md:flex">
            {READER_FACES.map(f => (
              <Chip key={f} on={ui.face === f} onClick={() => ui.setFace(f)}>
                {f}
              </Chip>
            ))}
          </span>
        </>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {left && <span className="mr-2 text-[10px]">{left}</span>}
        <ActionButton icon={ui.focus ? Minimize2 : Maximize2} label={ui.focus ? "exit focus (f)" : "focus (f)"} text={ui.focus ? "exit focus" : "focus"} onClick={() => ui.setFocus(!ui.focus)} />
        {!item.folder && (item.state === "done" ? <ActionButton icon={RotateCcw} label="mark unread (e)" onClick={() => onState("unread")} /> : <ActionButton icon={Check} label="mark done (e)" onClick={() => onState("done")} />)}
        {!item.folder && <ActionButton icon={Archive} label="archive (#)" onClick={() => onState("archived")} />}
        <MovePicker item={item} folders={folders} open={picking} onOpen={onPicking} onMove={onMove} />
        {nextUp && <ActionButton icon={SkipForward} label={`next in folder: ${nextUp.item.title}`} text={`next · ${String(nextUp.n).padStart(2, "0")}`} onClick={() => onNext(nextUp.item.id)} />}
        <ActionButton icon={ExternalLink} label="open original (o)" href={item.url} />
        <SendButton item={item} />
      </span>
    </div>
  );
}

function FocusBar({ kind, folder, item }: { kind: LaterKind; folder: LaterFolder | null; item: LaterItem }) {
  const ui = useLaterUi();
  const plan = upNext(useLater().data ?? [], item, ui.budget);
  const total = [item, ...plan.next].reduce((sum, i) => sum + (i.lengthSec ?? 0) * (1 - i.progress), 0);
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-2 md:px-5">
      {folder ? <span className="text-[12px] font-semibold">{folder.name}</span> : <KindSwitch kind={kind} counts={kindCounts(useLater().data ?? [])} />}
      <span className={cn("flex items-center gap-2 text-[10px] text-dim", folder && "hidden")}>
        i have
        <span className="flex border border-rule">
          {[...BUDGETS, null].map(b => (
            <button key={String(b)} type="button" aria-pressed={ui.budget === b} onClick={() => ui.setBudget(b)} className={cn("cursor-pointer border-0 px-2.5 py-1 font-mono text-[10px]", ui.budget === b ? "bg-lift text-fg" : "bg-transparent text-dim hover:text-fg")}>
              {b === null ? "all" : b === 60 ? "1h" : `${b}m`}
            </button>
          ))}
        </span>
      </span>
      <span className="ml-auto text-[10px] text-dim">
        session: {plan.next.length + 1} {folder ? "items" : kind === "watch" ? "videos" : "reads"} · {Math.round(total / 60)} min
      </span>
      <button type="button" onClick={() => ui.setFocus(false)} className="flex cursor-pointer items-center gap-1.5 border border-rule bg-transparent px-2.5 py-1 font-mono text-[10px] text-dim hover:text-fg">
        <Minimize2 aria-hidden className="size-3" />
        exit focus f / esc
      </button>
    </div>
  );
}

function UpNext({ items, current, budget, onPick }: { items: readonly LaterItem[]; current: LaterItem; budget: Budget; onPick: (id: string) => void }) {
  const plan = upNext(items, current, budget);
  const entry = (i: LaterItem, n: number, over: boolean) => (
    <button
      key={i.id}
      type="button"
      onClick={() => onPick(i.id)}
      aria-current={i.id === current.id || undefined}
      className={cn("flex w-full cursor-pointer items-center gap-3 border-0 border-b border-rule bg-transparent px-5 py-2.5 text-left font-mono", i.id === current.id ? "bg-raise shadow-[inset_2px_0_0_var(--color-fg)]" : "hover:bg-hover", over && "opacity-40")}
    >
      <span className="text-[10px] text-dim">{String(n).padStart(2, "0")}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 font-serif text-[13px] leading-snug text-fg">{i.title}</span>
        <span className="text-[10px] text-dim">{i.id === current.id ? "now" : (leftLabel(i) ?? (i.lengthSec ? `${Math.round(i.lengthSec / 60)} min` : i.site))}</span>
      </span>
    </button>
  );
  return (
    <SidePanel id="later-queue" label="up next" className="flex">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3.5 text-[12px] font-semibold">
        up next
        {current.kind === "watch" && <span className="text-[10px] font-normal text-ok">autoplay on</span>}
      </div>
      {entry(current, 1, false)}
      {plan.next.map((i, n) => entry(i, n + 2, false))}
      {plan.over.length > 0 && (
        <>
          <span className="px-5 py-2 text-[10px] text-dim">over your {budget === 60 ? "1h" : `${budget}m`} budget</span>
          {plan.over.map((i, n) => entry(i, plan.next.length + n + 2, true))}
        </>
      )}
    </SidePanel>
  );
}
