import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { NoteFile, NoteHit, NoteMeta, NoteSave, NotesSnapshot } from "@/shared/notes";
import { createResolver } from "@/shared/wikilinks";
import { get, keys, post } from "../api";
import type { WikiSource, WikiSuggestion } from "../editor/wiki";
import { navigate, notesHref } from "../router";
import { buildGraph, folderColors, layoutGraph, type Graph, type Layout } from "./graph";

export const useNotes = () => useQuery({ queryKey: keys.notes, queryFn: () => get<NotesSnapshot>("/api/notes"), staleTime: Infinity });

export const useNoteFile = (id: string | null) =>
  useQuery({ queryKey: keys.noteFile(id ?? ""), queryFn: () => get<NoteFile>(`/api/notes/file?id=${encodeURIComponent(id ?? "")}`), enabled: id !== null, staleTime: Infinity });

export const useNoteSearch = (q: string) =>
  useQuery({ queryKey: keys.noteSearch(q.trim()), queryFn: () => get<NoteHit[]>(`/api/notes/search?q=${encodeURIComponent(q.trim())}`), enabled: q.trim() !== "", placeholderData: keepPreviousData, staleTime: 30_000 });

export const useSaveNote = () => useMutation({ mutationFn: (s: NoteSave) => post("/api/notes/file", s) });
export const useCreateNote = () => useMutation({ mutationFn: (id: string) => post("/api/notes/new", { id }) });

export type Vault = {
  notes: readonly NoteMeta[];
  byId: ReadonlyMap<string, NoteMeta>;
  resolve: (target: string) => string | null;
  graph: Graph;
  colors: ReadonlyMap<string, string>;
};

const vaults = new WeakMap<readonly NoteMeta[], Vault>();

function vaultOf(notes: readonly NoteMeta[]): Vault {
  const known = vaults.get(notes);
  if (known) return known;
  const vault = { notes, byId: new Map(notes.map(n => [n.id, n])), resolve: createResolver(notes.map(n => n.id)), graph: buildGraph(notes), colors: folderColors(notes) };
  vaults.set(notes, vault);
  return vault;
}

export function useVault(): { vault: Vault | null; reason: string | null } {
  const { data, isPending } = useNotes();
  const vault = data?.kind === "ready" ? vaultOf(data.notes) : null;
  return { vault, reason: data?.kind === "unavailable" ? data.reason : isPending ? "reading the vault" : null };
}

const layouts = new WeakMap<Graph, Layout>();
let lastLayout: Layout | undefined;

export function layoutOf(graph: Graph): Layout {
  const known = layouts.get(graph);
  if (known) return known;
  const layout = layoutGraph(graph, lastLayout);
  layouts.set(graph, layout);
  lastLayout = layout;
  return layout;
}

function suggestionsOf(notes: readonly NoteMeta[]): WikiSuggestion[] {
  const count = new Map<string, number>();
  for (const n of notes) count.set(n.title.toLowerCase(), (count.get(n.title.toLowerCase()) ?? 0) + 1);
  return notes.toSorted((a, b) => b.mtime - a.mtime).map(n => ({ title: n.title, folder: n.folder, insert: (count.get(n.title.toLowerCase()) ?? 0) > 1 ? n.id : n.title }));
}

export function useWiki(): WikiSource | null {
  const { vault } = useVault();
  return useMemo(() => {
    if (!vault) return null;
    const suggestions = suggestionsOf(vault.notes);
    return {
      exists: target => vault.resolve(target) !== null,
      suggestions: () => suggestions,
      peek: target => {
        const id = vault.resolve(target);
        const note = id ? vault.byId.get(id) : undefined;
        return note ? { title: note.title, folder: note.folder, excerpt: note.excerpt } : null;
      },
      open: target => navigate(notesHref(vault.resolve(target) ?? target)),
    };
  }, [vault]);
}
