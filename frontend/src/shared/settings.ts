import { z } from "zod";

export const SettingsSchema = z.object({
  fleet: z.object({
    tempHotC: z.number(),
    diskFullPct: z.number(),
    loadHotPct: z.number(),
  }),
  lists: z.object({
    pageSize: z.number().int().positive(),
  }),
  tasks: z.object({
    carryDays: z.number().int().positive(),
    pollMs: z.number().int().positive(),
    staleAfterMs: z.number().int().positive(),
    cacheMs: z.number().int().positive(),
    catchUpMs: z.number().int().positive(),
    linearGithubBot: z.string(),
  }),
  ship: z.object({
    org: z.string().nullable(),
    bodyRefreshMs: z.number().int().positive(),
  }),
  later: z.object({
    staleDays: z.number().int().positive(),
    saveEveryMs: z.number().int().positive(),
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;
