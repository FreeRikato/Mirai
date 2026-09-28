import { cn } from "cn";
import { Minus, Plus, Scan, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ago } from "../format";
import { navigate, notesHref } from "../router";
import { layoutOf, useNoteSearch, type Vault } from "./api";
import { fitCamera, toScreen, zoomAt, type Camera, type Size } from "./camera";
import { edgeKey, GraphCanvas, type Emphasis } from "./GraphCanvas";
import { neighborhood, subgraph } from "./graph";
import { NewNoteButton } from "./NewNote";
import { useNotesUi } from "./store";

const DEPTHS = ["1", "2", "3"] as const;
const PEEK_WIDTH = 320;
const RETURN_ZOOM = 2.5;

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA");

export function NotesGraph({ vault }: { vault: Vault }) {
  const ui = useNotesUi();
  const layout = layoutOf(vault.graph);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const { data: hits } = useNoteSearch(query);
  const searching = query.trim() !== "";
  const focus = ui.focus && vault.byId.has(ui.focus) ? ui.focus : null;
  const local = ui.scope === "local" && focus !== null;

  const shown = useMemo(() => {
    const visible = new Set(vault.graph.nodes.filter(n => !ui.hidden.includes(n.folder)).map(n => n.id));
    const scoped = local ? new Set([...neighborhood(vault.graph, focus, ui.depth)].filter(id => visible.has(id) || id === focus)) : visible;
    return subgraph(vault.graph, scoped);
  }, [vault.graph, ui.hidden, local, focus, ui.depth]);

  const camera: Camera = ui.camera ?? fitCamera(layout, shown.nodes.map(n => n.id), size);
  const setCamera = ui.setCamera;

  useEffect(() => {
    if (size.w === 0) return;
    const p = focus ? layout.get(focus) : undefined;
    if (local) setCamera(fitCamera(layout, shown.nodes.map(n => n.id), size));
    else if (p) setCamera({ x: p.x, y: p.y, k: useNotesUi.getState().camera?.k ?? Math.min(1, fitCamera(layout, shown.nodes.map(n => n.id), size).k * RETURN_ZOOM) });
  }, [focus, local, ui.depth, size.w === 0]);

  const emphasis = useMemo((): Emphasis => {
    const trail = ui.trail.filter(id => vault.byId.has(id));
    const rings = new Map<string, "strong" | "soft">(trail.map(id => [id, "soft"]));
    if (focus) rings.set(focus, "strong");
    if (searching) {
      const ids = new Set((hits ?? []).map(h => h.id));
      return { lit: ids, rings: new Map([...ids].map(id => [id, "strong"])), strongEdges: new Set(), labels: ids };
    }
    if (hover) {
      rings.set(hover, "strong");
      const near = neighborhood(shown, hover, 1);
      return { lit: near, rings, strongEdges: new Set([...near].filter(id => id !== hover).map(id => edgeKey(hover, id))), labels: near };
    }
    const steps = trail.slice(1).map((id, i) => edgeKey(trail[i] ?? id, id));
    return { lit: null, rings, strongEdges: new Set(steps), labels: focus ? neighborhood(shown, focus, 1) : new Set() };
  }, [ui.trail, focus, searching, hits, hover, shown, vault.byId]);

  const open = (id: string) => navigate(notesHref(id));
  const flyTo = (id: string) => ui.setFocus(id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector("[role=dialog]")) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "Enter" && focus) open(focus);
      else if (e.key === "Escape" && focus) ui.setFocus(null);
      else if (e.key === "Backspace" && ui.trail.length > 0) {
        e.preventDefault();
        ui.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of vault.notes) counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1);
    return [...vault.colors.keys()].map(f => ({ folder: f, count: counts.get(f) ?? 0 })).filter(f => f.count > 0);
  }, [vault]);
  const orphans = vault.graph.nodes.filter(n => n.degree === 0).length;
  const hovered = hover ? vault.byId.get(hover) : undefined;
  const hoverPoint = hover ? layout.get(hover) : undefined;
  const hoverAt = hoverPoint ? toScreen(camera, size, hoverPoint) : null;

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="notes-graph">
      <GraphCanvas
        graph={shown}
        layout={layout}
        colors={vault.colors}
        camera={camera}
        onCamera={setCamera}
        emphasis={emphasis}
        onHover={setHover}
        onOpen={open}
        onPin={flyTo}
        onSize={setSize}
        label={`graph of ${shown.nodes.length} notes`}
      />

      <Command
        shouldFilter={false}
        value={picked}
        onValueChange={setPicked}
        onKeyDown={e => {
          if (e.key === "Escape") {
            e.preventDefault();
            setQuery("");
            search.current?.blur();
          } else if (e.key === "Enter" && e.shiftKey && picked) {
            e.preventDefault();
            flyTo(picked);
            setQuery("");
            search.current?.blur();
          }
        }}
        className="absolute top-4 left-4 h-auto w-[min(380px,calc(100%-2rem))] overflow-visible bg-transparent font-mono"
      >
        <label className={cn("flex h-8 items-center gap-2 border bg-bg px-3", searching ? "border-fg" : "border-rule")}>
          <Search aria-hidden className={cn("size-3.5", searching ? "text-fg" : "text-dim")} />
          <input
            ref={search}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search notes, or jump to one"
            aria-label="search notes"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[11px] text-fg outline-none placeholder:text-dim"
          />
          <span className="text-[10px] text-dim">{searching ? `${hits?.length ?? 0} of ${vault.notes.length}` : "/"}</span>
        </label>
        {searching && (
          <div className="border border-t-0 border-fg bg-bg">
            <CommandList className="max-h-[360px]">
              <CommandEmpty className="px-3 py-3 text-[11px] text-dim">no note mentions “{query.trim()}”</CommandEmpty>
              {(hits ?? []).map(h => (
                <CommandItem
                  key={h.id}
                  value={h.id}
                  onSelect={() => open(h.id)}
                  className="flex-col items-stretch gap-1 rounded-none border-l-2 border-transparent px-3 py-2 data-[selected=true]:border-fg data-[selected=true]:bg-accent"
                >
                  <span className="flex items-center gap-2 text-[11px] text-fg">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: vault.colors.get(vault.byId.get(h.id)?.folder ?? "") }} />
                    <span className="truncate">{h.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-dim">{h.inTitle ? "title" : vault.byId.get(h.id)?.folder || "vault"}</span>
                  </span>
                  <span className="line-clamp-2 font-serif text-[12px] leading-[1.45] text-dim">{h.snippet}</span>
                </CommandItem>
              ))}
            </CommandList>
            <div className="flex gap-3.5 border-t border-rule px-3 py-2 text-[10px] text-dim">
              <span>enter open</span>
              <span>shift+enter focus</span>
              <span>esc clear</span>
            </div>
          </div>
        )}
      </Command>

      {focus && !searching && (
        <nav aria-label="trail" className="absolute top-4 left-[416px] hidden h-8 items-center gap-2.5 text-[10px] text-dim lg:flex">
          <button type="button" onClick={() => ui.setFocus(null)} className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-dim hover:text-fg">
            graph
          </button>
          {ui.trail.filter(id => vault.byId.has(id)).map(id => (
            <span key={id} className="flex items-center gap-2.5">
              <span aria-hidden>›</span>
              <button type="button" onClick={() => flyTo(id)} className={cn("cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px]", id === focus ? "font-semibold text-fg" : "text-dim hover:text-fg")}>
                {vault.byId.get(id)?.title}
              </button>
            </span>
          ))}
          <span className="ml-2">enter reopen · esc clear · bksp back</span>
        </nav>
      )}

      <div className="absolute top-4 right-4 flex items-center gap-4 text-[10px]">
        <ToggleGroup type="single" variant="outline" size="sm" value={local ? "local" : "global"} onValueChange={v => v && ui.setScope(v === "local" ? "local" : "global")} aria-label="graph scope">
          <ToggleGroupItem value="global" className="h-7 px-2.5 font-mono text-[10px]">
            global
          </ToggleGroupItem>
          <ToggleGroupItem value="local" disabled={!focus} className="h-7 px-2.5 font-mono text-[10px]">
            local
          </ToggleGroupItem>
        </ToggleGroup>
        {local && (
          <ToggleGroup type="single" variant="outline" size="sm" value={String(ui.depth)} onValueChange={v => v && ui.setDepth(Number(v))} aria-label="depth">
            {DEPTHS.map(d => (
              <ToggleGroupItem key={d} value={d} aria-label={`depth ${d}`} className="h-7 w-7 font-mono text-[10px]">
                {d}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="zoom out" onClick={() => setCamera(zoomAt(camera, size, 1 / 1.25))}>
            <Minus />
          </Button>
          <span className="w-10 text-center text-fg tabular-nums">{Math.round(camera.k * 100)}%</span>
          <Button variant="ghost" size="icon-xs" aria-label="zoom in" onClick={() => setCamera(zoomAt(camera, size, 1.25))}>
            <Plus />
          </Button>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="fit graph" onClick={() => setCamera(fitCamera(layout, shown.nodes.map(n => n.id), size))}>
          <Scan />
        </Button>
        <NewNoteButton vault={vault} />
      </div>

      <ul aria-label="folders" className="absolute bottom-4 left-4 m-0 flex list-none flex-col gap-1 p-0">
        {folders.map(({ folder, count }) => {
          const off = ui.hidden.includes(folder);
          return (
            <li key={folder || "root"}>
              <button type="button" aria-pressed={!off} onClick={() => ui.toggleFolder(folder)} className={cn("flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-mono text-[10px]", off ? "text-faint" : "text-fg")}>
                <span className="size-[7px] rounded-full" style={{ background: vault.colors.get(folder), opacity: off ? 0.3 : 1 }} />
                <span className="w-24 truncate text-left">{folder || "vault root"}</span>
                <span className="text-dim">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="absolute right-4 bottom-4 hidden gap-5 text-[10px] text-dim md:flex">
        <span>drag pan · scroll zoom · click open · shift+click focus</span>
        <span className="text-fg">
          {vault.notes.length} notes · {vault.graph.edges.length} links · {orphans} orphans
        </span>
      </div>

      {hovered && hoverAt && !searching && (
        <div
          role="tooltip"
          className="pointer-events-none absolute flex w-[320px] flex-col gap-2 border border-fg bg-bg px-3.5 py-3"
          style={{ left: Math.min(Math.max(8, hoverAt.x - PEEK_WIDTH / 2), size.w - PEEK_WIDTH - 8), top: hoverAt.y > size.h / 2 ? undefined : hoverAt.y + 24, bottom: hoverAt.y > size.h / 2 ? size.h - hoverAt.y + 24 : undefined }}
        >
          <span className="flex items-center gap-2">
            <span className="size-[7px] rounded-full" style={{ background: vault.colors.get(hovered.folder) }} />
            <span className="truncate text-[12px] font-semibold text-fg">{hovered.title}</span>
            <span className="ml-auto shrink-0 text-[10px] text-dim">{hovered.folder || "vault"}</span>
          </span>
          {hovered.excerpt && <span className="line-clamp-3 font-serif text-[13px] leading-[1.5] text-soft">{hovered.excerpt}</span>}
          <span className="flex gap-3.5 text-[10px] text-dim">
            <span>{hovered.links.length} out · {vault.notes.filter(n => n.links.some(l => l.to === hovered.id)).length} in</span>
            <span>edited {ago(hovered.mtime)}</span>
            <span className="ml-auto text-fg">click to open</span>
          </span>
        </div>
      )}
    </div>
  );
}
