import { z } from "zod";

export type NoteLink = { to: string; context: string };

export type NoteMeta = {
  id: string;
  title: string;
  folder: string;
  mtime: number;
  words: number;
  excerpt: string;
  links: NoteLink[];
};

export type NotesSnapshot = { kind: "ready"; notes: NoteMeta[]; changedAt: number } | { kind: "unavailable"; reason: string };

export type NoteFile = { id: string; text: string; mtime: number };

export type NoteHit = { id: string; title: string; snippet: string; inTitle: boolean };

const SEGMENT = /^(?!\.)[^/\\\0]+$/;

export const NoteIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(id => id.split("/").every(s => SEGMENT.test(s) && s.trim() === s && s !== ".."), "not a vault-relative note path");

export const NoteSaveSchema = z.object({ id: NoteIdSchema, base: z.string(), next: z.string() });
export const NoteCreateSchema = z.object({ id: NoteIdSchema });

export type NoteSave = z.infer<typeof NoteSaveSchema>;

export const noteTitle = (id: string): string => id.slice(id.lastIndexOf("/") + 1);
export const noteFolder = (id: string): string => (id.includes("/") ? id.slice(0, id.indexOf("/")) : "");

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/;

export const frontmatterOf = (text: string): string => FRONTMATTER.exec(text)?.[0] ?? "";
export const noteBody = (text: string): string => text.replace(FRONTMATTER, "");
