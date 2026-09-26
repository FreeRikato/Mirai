import { z } from "zod";

export const Px0OpenSchema = z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), number: z.number().int().positive() });
export type Px0Open = z.infer<typeof Px0OpenSchema>;

export const Px0StopSchema = z.object({ id: z.string().min(1) });

export type Px0Session = {
  id: string;
  repo: string;
  number: number;
  path: string;
  ready: boolean;
  viewing: boolean;
  startedAt: number;
  lastUsedAt: number;
  rssMb: number | null;
};

export type Px0Sessions = { idleMs: number; sessions: Px0Session[] };

export const px0Id = (repo: string, number: number): string => `${repo.split("/").at(-1)?.toLowerCase() ?? "repo"}-${number}`;

export const Px0OpenedSchema = z.object({ path: z.string().startsWith("/px0/") });
