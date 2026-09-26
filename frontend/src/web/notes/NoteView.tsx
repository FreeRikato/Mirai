import { cn } from "cn";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { NoteFile } from "@/shared/notes";
import { LazyMarkdownEditor } from "../editor/LazyMarkdownEditor";
import { ago } from "../format";
import { navigate, notesHref } from "../router";
import { SidePanel } from "../shell/SidePanel";
import { InlineMarkdown } from "../tasks/ui/Markdown";
import { useCreateNote, layoutOf, useNoteFile, useSaveNote, useWiki, type Vault } from "./api";
import { fitCamera, type Camera, type Size } from "./camera";
import { edgeKey, GraphCanvas } from "./GraphCanvas";
import { backlinksOf, neighborhood, subgraph } from "./graph";
import { useNotesUi } from "./store";

const AUTOSAVE_MS = 700;

const toGraph = () => navigate(notesHref(null));

function useEscapeToGraph() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog]")) toGraph();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function NoteView({ target, vault }: { target: string; vault: Vault }) {
  useEscapeToGraph();
  const id = vault.byId.has(target) ? target : vault.resolve(target);
  return id ? <NoteDetail key={id} id={id} vault={vault} /> : <MissingNote target={target} />;
}

function NoteBar({ crumbs, status }: { crumbs: readonly string[]; status: React.ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-4 border-b border-rule px-5 text-[10px]">
      <Button variant="outline" size="xs" onClick={toGraph} className="h-[26px] gap-2 border-fg font-mono text-[10px]">
        <ArrowLeft aria-hidden />
        graph
        <span className="text-dim">esc</span>
      </Button>
      <nav aria-label="note path" className="flex min-w-0 items-center gap-2 text-dim">
        {crumbs.map((c, i) => (
          <span key={i} className={cn("truncate", i === crumbs.length - 1 && "text-fg")}>
            {i > 0 && <span className="mr-2">/</span>}
            {c}
          </span>
        ))}
      </nav>
      <span className="ml-auto shrink-0">{status}</span>
    </div>
  );
}

function MissingNote({ target }: { target: string }) {
  const create = useCreateNote();
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <NoteBar crumbs={[target]} status={null} />
      <div className="flex flex-col items-start gap-3 p-10">
        <p className="m-0 font-serif text-[17px] text-soft">No note is called “{target}” yet.</p>
        <Button size="xs" disabled={create.isPending} onClick={() => create.mutate(target, { onSuccess: () => navigate(notesHref(target)) })} className="font-mono text-[10px]">
          create {target}.md
        </Button>
        {create.error && <span className="text-[10px] text-bad">{create.error.message}</span>}
      </div>
    </div>
  );
}

function NoteDetail({ id, vault }: { id: string; vault: Vault }) {
  const visit = useNotesUi(s => s.visit);
  useEffect(() => visit(id), [id, visit]);
  const { data: file, error } = useNoteFile(id);
  const note = vault.byId.get(id);
  const crumbs = id.split("/");

  if (!file) return <div className="flex min-w-0 flex-1 flex-col"><NoteBar crumbs={crumbs} status={error ? <span className="text-bad">{error.message}</span> : "opening"} /></div>;
  return <NoteBody key={id} file={file} vault={vault} crumbs={crumbs} words={note?.words ?? 0} />;
}

function NoteBody({ file, vault, crumbs, words }: { file: NoteFile; vault: Vault; crumbs: readonly string[]; words: number }) {
  const [base, setBase] = useState(file.text);
  const [draft, setDraft] = useState(file.text);
  const save = useSaveNote();
  const wiki = useWiki();
  const dirty = draft !== base;

  useEffect(() => {
    if (file.text !== base && draft === base) {
      setBase(file.text);
      setDraft(file.text);
    }
  }, [file.text]);

  const flush = () => {
    if (!dirty || save.isPending) return;
    const next = draft;
    save.mutate({ id: file.id, base, next }, { onSuccess: () => setBase(next) });
  };

  useEffect(() => {
    if (!dirty || save.isPending || save.isError) return;
    const t = setTimeout(flush, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [draft, base, save.isPending, save.isError]);

  const reload = () => {
    save.reset();
    setBase(file.text);
    setDraft(file.text);
  };

  const status = save.error ? (
    <span className="flex items-center gap-2 text-bad">
      {save.error.message}
      <Button variant="outline" size="xs" onClick={reload} className="h-5 font-mono text-[10px]">
        reload from disk
      </Button>
    </span>
  ) : save.isPending ? (
    "saving"
  ) : dirty ? (
    <span className="text-warn">unsaved</span>
  ) : (
    "saved"
  );

  const note = vault.byId.get(file.id);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <NoteBar crumbs={crumbs} status={status} />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <article className="mx-auto flex max-w-[680px] flex-col gap-4 px-6 pt-10 pb-24">
            <h1 className="m-0 font-serif text-[32px] leading-[1.2] font-semibold">{crumbs.at(-1)}</h1>
            <div className="flex items-center gap-3.5 text-[10px] text-dim">
              <span className="size-[7px] rounded-full" style={{ background: vault.colors.get(note?.folder ?? "") }} />
              <span>{note?.folder || "vault"}</span>
              <span>edited {ago(file.mtime)}</span>
              <span>{words} words</span>
            </div>
            <LazyMarkdownEditor value={draft} onChange={setDraft} onBlur={flush} onSave={flush} label="note markdown" wiki={wiki} variant="prose" className="mt-2" />
          </article>
        </main>
        <SidePanel id="notes-side" label="links" className="hidden md:flex">
          <LocalGraph id={file.id} vault={vault} />
          <LinkList title="backlinks" items={backlinksOf(vault.notes, file.id)} vault={vault} />
          <LinkList title="outgoing" items={(note?.links ?? []).map(l => ({ id: l.to, context: "" }))} vault={vault} />
        </SidePanel>
      </div>
    </div>
  );
}

const LOCAL_HEIGHT = 240;

function LocalGraph({ id, vault }: { id: string; vault: Vault }) {
  const layout = layoutOf(vault.graph);
  const graph = useMemo(() => subgraph(vault.graph, neighborhood(vault.graph, id, 1)), [vault.graph, id]);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const fitted = fitCamera(layout, graph.nodes.map(n => n.id), size, 40);
  const emphasis = useMemo(
    () => ({ lit: null, rings: new Map([[id, "strong" as const], ...(hover ? [[hover, "soft" as const] as const] : [])]), strongEdges: new Set(hover ? [edgeKey(id, hover)] : []), labels: graph.nodes.length <= 12 ? new Set(graph.nodes.map(n => n.id)) : new Set<string>() }),
    [id, hover, graph],
  );
  return (
    <section aria-label="local graph" className="border-b border-rule">
      <div className="flex items-center gap-2 px-4 py-3 text-[10px]">
        <span className="text-fg">local graph</span>
        <span className="text-dim">depth 1</span>
      </div>
      <div style={{ height: LOCAL_HEIGHT }}>
        <GraphCanvas
          graph={graph}
          layout={layout}
          colors={vault.colors}
          camera={camera ?? fitted}
          onCamera={setCamera}
          emphasis={emphasis}
          onHover={setHover}
          onOpen={next => navigate(notesHref(next))}
          onSize={setSize}
          label={`${graph.nodes.length - 1} notes linked to this one`}
        />
      </div>
    </section>
  );
}

function LinkList({ title, items, vault }: { title: string; items: readonly { id: string; context: string }[]; vault: Vault }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5 border-b border-rule px-4 py-3.5">
      <span className="flex gap-2 text-[10px]">
        <span className="text-fg">{title}</span>
        <span className="text-dim">{items.length}</span>
      </span>
      {items.length === 0 && <span className="text-[10px] text-dim">none yet</span>}
      {items.map(item => {
        const n = vault.byId.get(item.id);
        return (
          <div key={item.id} className="flex flex-col gap-1">
            <a
              href={notesHref(item.id)}
              onClick={e => {
                e.preventDefault();
                navigate(notesHref(item.id));
              }}
              className="flex items-center gap-2 text-[11px] text-fg no-underline hover:underline"
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: vault.colors.get(n?.folder ?? "") }} />
              {n?.title ?? item.id}
            </a>
            {item.context && (
              <span className="line-clamp-2 font-serif text-[12px] leading-[1.45] text-dim">
                <InlineMarkdown>{item.context}</InlineMarkdown>
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}
