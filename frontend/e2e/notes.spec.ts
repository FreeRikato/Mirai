import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { buildIndex, searchNotes, type VaultFile } from "../src/hub/notes/vaultIndex";
import { NoteCreateSchema, NoteSaveSchema, type NotesSnapshot } from "../src/shared/notes";
import type { ServerMessage } from "../src/shared/schema";
import { events, fleet } from "./fixtures";

const VAULT: Record<string, string> = {
  "databrain/rls-policies": "Policies are inlined as security barrier quals.\n\nThe rewrite path is in [[postgres-internals|the rewriter]].\n\n- [ ] wrap current_setting in a subselect",
  "databrain/tenant-isolation": "Every tenant table is guarded by [[rls-policies]].",
  "postgres-internals": "Parse, rewrite, plan, execute.",
  "Daily/2026-09-24": "Read [[postgres-internals]] today.",
  "lonely-idea": "Nobody links here.",
};

async function mockNotes(page: Page, opts: { conflict?: boolean } = {}) {
  const files = new Map(Object.entries(VAULT).map(([id, text]) => [id, { id, text, mtime: Date.now() - 86_400_000 }] as const));
  const writes: { path: string; body: unknown }[] = [];
  let socket: WebSocketRoute | null = null;
  const all = (): VaultFile[] => [...files.values()];
  const snapshot = (): NotesSnapshot => ({ kind: "ready", notes: buildIndex(all()), changedAt: Date.now() });

  await page.route("**/api/fleet", r => r.fulfill({ json: fleet }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route(/\/api\/notes(\/[\w]+)?(\?.*)?$/, r => {
    const url = new URL(r.request().url());
    const post = r.request().method() === "POST";
    if (url.pathname === "/api/notes") return r.fulfill({ json: snapshot() });
    if (url.pathname === "/api/notes/search") return r.fulfill({ json: searchNotes(all(), url.searchParams.get("q") ?? "", 20) });
    if (url.pathname === "/api/notes/file" && !post) {
      const f = files.get(url.searchParams.get("id") ?? "");
      return f ? r.fulfill({ json: f }) : r.fulfill({ status: 404, json: { error: "no such note" } });
    }
    const body: unknown = r.request().postDataJSON();
    writes.push({ path: url.pathname, body });
    const save = NoteSaveSchema.safeParse(body);
    if (url.pathname === "/api/notes/file" && save.success) {
      if (opts.conflict) return r.fulfill({ status: 409, json: { error: `${save.data.id}.md changed since you loaded it` } });
      files.set(save.data.id, { id: save.data.id, text: save.data.next, mtime: Date.now() });
    }
    const created = NoteCreateSchema.safeParse(body);
    if (url.pathname === "/api/notes/new" && created.success) files.set(created.data.id, { id: created.data.id, text: "", mtime: Date.now() });
    socket?.send(JSON.stringify({ type: "notes", snapshot: snapshot() } satisfies ServerMessage));
    return r.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket("**/ws", ws => {
    socket = ws;
    ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage));
  });
  return { writes, files };
}

const editor = (page: Page) => page.getByRole("textbox", { name: "note markdown" });

test("the notes tab opens on the graph of the whole vault", async ({ page }) => {
  await mockNotes(page);
  await page.goto("/machines");
  await page.getByRole("navigation", { name: "modules" }).getByRole("link", { name: "notes" }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole("img", { name: "graph of 5 notes" })).toBeVisible();
  await expect(page.getByText("5 notes · 3 links · 1 orphans")).toBeVisible();
  const folders = page.getByRole("list", { name: "folders" });
  await expect(folders.getByRole("button", { name: /databrain\s*2/ })).toBeVisible();
  await folders.getByRole("button", { name: /databrain/ }).click();
  await expect(page.getByRole("img", { name: "graph of 3 notes" })).toBeVisible();
});

test("search lights up matches and enter opens the note with wiki-links rendered", async ({ page }) => {
  await mockNotes(page);
  await page.goto("/notes");
  await expect(page.getByRole("img", { name: "graph of 5 notes" })).toBeVisible();
  await page.keyboard.press("/");
  await page.keyboard.type("rewrite");
  await expect(page.getByRole("option", { name: /postgres-internals/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /rls-policies/ })).toBeVisible();
  await page.getByRole("option", { name: /rls-policies/ }).click();
  await expect(page).toHaveURL(/\/notes\/databrain%2Frls-policies$/);
  await expect(page.getByRole("heading", { name: "rls-policies" })).toBeVisible();
  await expect(editor(page).getByText("the rewriter")).toBeVisible();
  await expect(editor(page)).not.toContainText("[[");
  await expect(page.getByRole("region", { name: "backlinks" }).getByRole("link", { name: "tenant-isolation" })).toBeVisible();
});

test("editing autosaves through the hub, and [[ suggests notes to link", async ({ page }) => {
  const hub = await mockNotes(page);
  await page.goto("/notes/postgres-internals");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" See [[tenant");
  await page.getByRole("option", { name: /tenant-isolation/ }).click();
  await expect.poll(() => hub.files.get("postgres-internals")?.text).toBe("Parse, rewrite, plan, execute. See [[tenant-isolation]]");
  expect(hub.writes.at(-1)).toEqual({ path: "/api/notes/file", body: { id: "postgres-internals", base: "Parse, rewrite, plan, execute.", next: "Parse, rewrite, plan, execute. See [[tenant-isolation]]" } });
  await expect(page.getByText("saved", { exact: true })).toBeVisible();
});

test("a wiki-link opens its note, esc goes back to the graph centred on it, and clicking it reopens", async ({ page }) => {
  await mockNotes(page);
  await page.goto("/notes/databrain%2Frls-policies");
  await editor(page).getByText("the rewriter").click();
  await expect(page).toHaveURL(/\/notes\/postgres-internals$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/notes$/);
  const trail = page.getByRole("navigation", { name: "trail" });
  await expect(trail.getByRole("button", { name: "rls-policies" })).toBeVisible();
  await expect(trail.getByRole("button", { name: "postgres-internals" })).toBeVisible();
  const graph = page.getByRole("img", { name: /graph of/ });
  const box = await graph.boundingBox();
  if (!box) throw new Error("graph has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/notes\/postgres-internals$/);
});

test("a link to a note that does not exist offers to create it", async ({ page }) => {
  const hub = await mockNotes(page);
  await page.goto("/notes/fresh-idea");
  await page.getByRole("button", { name: "create fresh-idea.md" }).click();
  await expect(page.getByRole("heading", { name: "fresh-idea" })).toBeVisible();
  expect(hub.writes).toEqual([{ path: "/api/notes/new", body: { id: "fresh-idea" } }]);
});

test("a save that lost a race with Obsidian says so and can reload from disk", async ({ page }) => {
  await mockNotes(page, { conflict: true });
  await page.goto("/notes/lonely-idea");
  await editor(page).click();
  await page.keyboard.type("x");
  await expect(page.getByText("lonely-idea.md changed since you loaded it")).toBeVisible();
  await page.getByRole("button", { name: "reload from disk" }).click();
  await expect(editor(page)).toHaveText("Nobody links here.");
});
