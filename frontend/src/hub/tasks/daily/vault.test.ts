import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailyNotesDir } from "./vault";

let vault = "";
afterEach(() => rm(vault, { recursive: true, force: true }));

const withSettings = async (settings: unknown | null) => {
  vault = await mkdtemp(join(tmpdir(), "mirai-vault-"));
  if (settings !== null) await Bun.write(join(vault, ".obsidian", "daily-notes.json"), JSON.stringify(settings));
  return vault;
};

test("the folder comes from the vault's own Daily notes settings", async () => {
  const v = await withSettings({ folder: "Journal/Daily" });
  expect(await dailyNotesDir(v)).toEqual({ ok: true, dir: join(v, "Journal/Daily") });
});

test("no settings file means Obsidian's default: notes at the vault root", async () => {
  const v = await withSettings(null);
  expect(await dailyNotesDir(v)).toEqual({ ok: true, dir: v });
});

test("a date format other than YYYY-MM-DD is reported, not guessed at", async () => {
  const v = await withSettings({ folder: "Daily", format: "DD-MM-YYYY" });
  expect(await dailyNotesDir(v)).toMatchObject({ ok: false, reason: expect.stringContaining("DD-MM-YYYY") });
});

test("a missing vault is reported", async () => {
  expect(await dailyNotesDir(undefined)).toMatchObject({ ok: false, reason: expect.stringContaining("MIRAI_VAULT_DIR") });
});
