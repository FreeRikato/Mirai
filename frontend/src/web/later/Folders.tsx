import { cn } from "cn";
import { BookOpen, Check, FolderInput, FolderOpen, Folder as FolderIcon, Play, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LaterFolder, LaterItem } from "@/shared/later";
import { folderHref, navigate } from "../router";
import { SidebarSection, Unavailable } from "../tasks/ui/Layout";
import { useFolderActions } from "./api";
import { lengthLabel, timeLeft, type Side } from "./derive";
import { useLaterUi } from "./store";
import { DropLine, useDragOrder, type Place, type RowDrag } from "./dragOrder";

export function durationLabel(sec: number): string {
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

function NameInput({ label, initial, onDone }: { label: string; initial: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(initial);
  return (
    <input
      autoFocus
      aria-label={label}
      value={name}
      onChange={e => setName(e.target.value)}
      onBlur={() => onDone(null)}
      onKeyDown={e => {
        if (e.key === "Enter" && name.trim()) onDone(name.trim());
        if (e.key === "Escape") onDone(null);
      }}
      placeholder="folder name"
      className="h-6 min-w-0 flex-1 border border-fg bg-transparent px-2 font-mono text-[11px] text-fg outline-none placeholder:text-dim"
    />
  );
}

export function FoldersSection({ folders, items, active }: { folders: readonly LaterFolder[]; items: readonly LaterItem[]; active: string | null }) {
  const { create } = useFolderActions();
  const [adding, setAdding] = useState(false);
  const add = (
    <button type="button" aria-label="new folder" onClick={() => setAdding(true)} className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-mono text-[10px] text-dim hover:text-fg">
      <Plus aria-hidden className="size-3" />
      new
    </button>
  );
  return (
    <SidebarSection title="folders" right={add}>
      {folders.map(f => {
        const on = f.id === active;
        const Icon = on ? FolderOpen : FolderIcon;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={on}
            onClick={() => navigate(folderHref(f.id))}
            className={cn("-mx-2 flex cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1 font-mono text-[11px]", on ? "bg-lift text-fg shadow-[inset_2px_0_0_var(--color-fg)]" : "text-soft hover:bg-hover")}
          >
            <Icon aria-hidden className={cn("size-3 shrink-0", on ? "text-fg" : "text-dim")} />
            <span className="min-w-0 flex-1 truncate text-left">{f.name}</span>
            <span className="text-[10px] text-dim">{items.filter(i => i.folder?.id === f.id).length}</span>
          </button>
        );
      })}
      {adding && (
        <NameInput
          label="new folder name"
          initial=""
          onDone={name => {
            setAdding(false);
            if (name) create.mutate(name, { onSuccess: f => navigate(folderHref(f.id)) });
          }}
        />
      )}
      {folders.length === 0 && !adding && <span className="text-[10px] text-dim">group links you want to keep together</span>}
    </SidebarSection>
  );
}

function FolderRow({ item, n, on, onSelect, drag, line, dragging }: { item: LaterItem; n: number; on: boolean; onSelect: () => void; drag: RowDrag; line: Side | null; dragging: boolean }) {
  const KindIcon = item.kind === "watch" ? Play : BookOpen;
  const midway = item.progress > 0 && item.progress < 1;
  return (
    <button
      type="button"
      role="listitem"
      data-later={item.id}
      aria-current={on || undefined}
      onClick={onSelect}
      {...drag}
      className={cn("relative flex w-full cursor-pointer items-start gap-3 border-0 border-b border-rule bg-transparent px-5 py-3 text-left font-mono", on ? "bg-raise shadow-[inset_2px_0_0_var(--color-fg)]" : "hover:bg-hover", dragging && "opacity-30")}
    >
      <DropLine side={line} />
      <span className="w-4 shrink-0 pt-px text-[10px] text-dim">{String(n).padStart(2, "0")}</span>
      <KindIcon aria-label={item.kind} className="mt-0.5 size-3 shrink-0 text-dim" />
      {item.kind === "watch" && (
        <span className="relative h-[45px] w-20 shrink-0 overflow-hidden bg-track">
          {item.image && <img data-no-lightbox src={item.image} alt="" className="h-full w-full object-cover" />}
          {item.lengthSec !== null && <span className="absolute right-1 bottom-1 bg-[#000000cc] px-1 text-[9px] text-fg">{lengthLabel(item)}</span>}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-[12px] leading-snug text-fg">{item.title}</span>
        <span className="flex flex-wrap gap-x-2 text-[10px] text-dim">
          <span className="truncate">{item.site}</span>
          {item.kind === "read" && lengthLabel(item) && <span>· {lengthLabel(item)}</span>}
          {midway && <span className="text-fg">· {item.kind === "watch" ? "resume" : `${Math.round(item.progress * 100)}%`}</span>}
        </span>
      </span>
    </button>
  );
}

export function FolderPane({ folder, items, selected, loading, onSelect, onDeleted, onPlace }: { folder: LaterFolder; items: readonly LaterItem[]; selected: string | null; loading: boolean; onSelect: (id: string) => void; onDeleted: () => void; onPlace: Place }) {
  const { rename, remove } = useFolderActions();
  const { rowProps, lineAt, dragging } = useDragOrder(onPlace);
  const left = timeLeft(items, useLaterUi(s => s.speed));
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const link = "cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-dim hover:text-fg";
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-rule px-5 py-3.5">
        <span className="flex items-center gap-2">
          <FolderOpen aria-hidden className="size-3.5 shrink-0" />
          {editing ? (
            <NameInput
              label="folder name"
              initial={folder.name}
              onDone={name => {
                setEditing(false);
                if (name && name !== folder.name) rename.mutate({ id: folder.id, name });
              }}
            />
          ) : (
            <h2 className="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold">{folder.name}</h2>
          )}
          {!editing && !confirming && (
            <>
              <button type="button" onClick={() => setEditing(true)} className={link}>
                rename
              </button>
              <button type="button" onClick={() => setConfirming(true)} className={link}>
                delete
              </button>
            </>
          )}
        </span>
        {confirming ? (
          <span className="flex flex-wrap items-center gap-3 text-[10px]">
            <span className="text-warn">delete the folder? its {items.length} items go back to the queue as unread</span>
            <button type="button" onClick={() => remove.mutate(folder.id, { onSuccess: onDeleted })} className={cn(link, "text-fg underline")}>
              delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={link}>
              keep
            </button>
          </span>
        ) : (
          <span className="text-[10px] text-dim">
            {items.length} {items.length === 1 ? "item" : "items"}
            {left.sec > 0 && ` · ${durationLabel(left.sec)}`}
            {left.rate !== 1 && left.sec > 0 && <span className="text-fg"> · {durationLabel(left.atSpeed)} at {left.rate}x</span>}
          </span>
        )}
      </header>
      {loading ? (
        <Unavailable reason="loading" />
      ) : items.length === 0 ? (
        <Unavailable reason="nothing here yet. paste links above to save them into this folder, or press g on any item" />
      ) : (
        <div role="list" aria-label={`folder ${folder.name}`} className="flex flex-col">
          {items.map((item, n) => (
            <FolderRow key={item.id} item={item} n={n + 1} on={item.id === selected} onSelect={() => onSelect(item.id)} drag={rowProps(item.id)} line={lineAt(item.id)} dragging={dragging === item.id} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MovePicker({ item, folders, open, onOpen, onMove }: { item: LaterItem; folders: readonly LaterFolder[]; open: boolean; onOpen: (open: boolean) => void; onMove: (folderId: string | null) => void }) {
  const { create } = useFolderActions();
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const here = folders.find(f => f.id === item.folder?.id);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => e.target instanceof Node && !box.current?.contains(e.target) && onOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, onOpen]);

  const pick = (folderId: string | null) => {
    onOpen(false);
    setAdding(false);
    onMove(folderId);
  };
  const option = "flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left font-mono text-[11px] text-soft hover:bg-hover hover:text-fg";

  return (
    <span ref={box} className="relative">
      <button
        type="button"
        aria-label="move to folder (g)"
        aria-expanded={open}
        title="move to folder (g)"
        onClick={() => onOpen(!open)}
        className={cn("flex h-6 max-w-[200px] cursor-pointer items-center gap-1.5 border bg-transparent px-2 font-mono text-[10px] hover:border-dim hover:text-fg", here ? "border-fg text-fg" : "border-rule text-dim")}
      >
        <FolderInput aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{here ? here.name : "folder"}</span>
      </button>
      {open && (
        <div role="menu" aria-label="move to folder" className="absolute top-7 right-0 z-30 flex w-60 flex-col border border-rule bg-bg py-1 shadow-[0_8px_24px_#000]">
          {folders.map(f => (
            <button key={f.id} type="button" role="menuitem" onClick={() => pick(f.id)} className={option}>
              <span className="w-3 shrink-0">{f.id === here?.id && <Check aria-hidden className="size-3" />}</span>
              <span className="truncate">{f.name}</span>
            </button>
          ))}
          {here && (
            <button type="button" role="menuitem" onClick={() => pick(null)} className={cn(option, "border-t border-rule")}>
              <span className="w-3 shrink-0" />
              ungroup, back to the queue
            </button>
          )}
          <span className="flex border-t border-rule px-3 py-1.5">
            {adding ? (
              <NameInput label="new folder name" initial="" onDone={name => (name ? create.mutate(name, { onSuccess: f => pick(f.id) }) : setAdding(false))} />
            ) : (
              <button type="button" role="menuitem" onClick={() => setAdding(true)} className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-mono text-[11px] text-dim hover:text-fg">
                <Plus aria-hidden className="size-3" />
                new folder
              </button>
            )}
          </span>
        </div>
      )}
    </span>
  );
}
