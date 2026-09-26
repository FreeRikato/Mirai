import { z } from "zod";

export type Token = readonly [text: string, color: string];
export type TokenLine = readonly Token[];
export type Highlight = { kind: "ready"; lines: TokenLine[] } | { kind: "unavailable"; reason: string };

const Sha = z.string().regex(/^[0-9a-f]{40}$/);

export const CodeTargetSchema = z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), head: Sha, base: Sha });
export type CodeTarget = z.infer<typeof CodeTargetSchema>;

const RepoPathSchema = z
  .string()
  .min(1)
  .refine(p => !p.startsWith("/") && !p.split("/").some(part => part === ".." || part === "." || part === ""), "expected a path inside the repository");

export const HighlightQuerySchema = CodeTargetSchema.extend({ path: RepoPathSchema, side: z.enum(["old", "new"]) });
export type HighlightQuery = z.infer<typeof HighlightQuerySchema>;
