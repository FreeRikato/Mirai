import { join } from "node:path";
import { z } from "zod";

export const NOTE_FORMAT = "YYYY-MM-DD";

const DailySettingsSchema = z.object({ folder: z.string().optional(), format: z.string().optional() });

export type NotesDir = { ok: true; dir: string } | { ok: false; reason: string };

export async function dailyNotesDir(vaultDir: string | undefined): Promise<NotesDir> {
  if (!vaultDir) return { ok: false, reason: "set MIRAI_VAULT_DIR on the hub to the Obsidian vault folder" };
  const file = Bun.file(join(vaultDir, ".obsidian", "daily-notes.json"));
  const raw: unknown = (await file.exists()) ? await file.json().catch(() => null) : {};
  const parsed = DailySettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "cannot read the vault's .obsidian/daily-notes.json" };

  const format = parsed.data.format?.trim() || NOTE_FORMAT;
  if (format !== NOTE_FORMAT) return { ok: false, reason: `daily notes are named ${format}; only ${NOTE_FORMAT} is supported` };
  const folder = parsed.data.folder?.trim() ?? "";
  return { ok: true, dir: folder ? join(vaultDir, folder) : vaultDir };
}
