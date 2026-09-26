import { expect, test, type Page } from "@playwright/test";
import type { ServerMessage } from "../src/shared/schema";
import { FolderNameSchema, FolderOrderSchema, MoveSchema, SaveSchema, type LaterFolder, type LaterItem, type LaterReader, type SaveOutcome, type Transcript, type WorthSnapshot } from "../src/shared/later";
import { events, fleet } from "./fixtures";

const item = (over: Partial<LaterItem> & Pick<LaterItem, "id" | "title">): LaterItem => ({
  url: `https://${over.id}.dev/post`,
  kind: "read",
  embed: { type: "article" },
  site: `${over.id}.dev`,
  author: null,
  image: null,
  lengthSec: 600,
  progress: 0,
  position: 0,
  state: "unread",
  worth: "full",
  tldr: [],
  chapters: [],
  folder: null,
  savedAt: Date.now(),
  queueOrder: over.savedAt ?? Date.now(),
  ...over,
});

const RLS: LaterFolder = { id: "rls", name: "rls deep dive", createdAt: 1 };

const START: LaterItem[] = [
  item({ id: "agents", title: "Building effective agents" }),
  item({ id: "policies", title: "Row security policies", folder: { id: "rls", order: 1 }, state: "done" }),
  item({ id: "talk", title: "RLS in ten minutes", kind: "watch", site: "youtube.com", embed: { type: "video" }, lengthSec: 602, folder: { id: "rls", order: 2 } }),
];

async function fakeHub(page: Page) {
  let items = START;
  let folders = [RLS];
  const saves: { url: string; folderId?: string }[] = [];
  const orders: string[][] = [];
  const queueOrders: string[][] = [];
  const kindOf = (url: string) => (url.includes("youtube") ? "watch" : "read");

  await page.route("**/api/fleet", r => r.fulfill({ json: fleet }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route("**/api/later-worth/*", r => r.fulfill({ json: { kind: "unranked" } satisfies WorthSnapshot }));
  await page.route("**/api/later/*/reader", r => r.fulfill({ json: { kind: "ready", html: "<p>body</p>", words: 1 } satisfies LaterReader }));
  await page.route("**/api/later/*/transcript", r => r.fulfill({ json: { status: "unsupported" } satisfies Transcript }));
  await page.route("**/api/later", r => {
    if (r.request().method() !== "POST") return r.fulfill({ json: items });
    const body = SaveSchema.parse(r.request().postDataJSON());
    saves.push(body);
    if (body.url.includes("broken")) return r.fulfill({ status: 502, json: { error: "the page could not be fetched" } });
    const folderId = body.folderId;
    const order = items.filter(i => i.folder?.id === folderId).length + 1;
    const made = item({ id: `new${saves.length}`, title: `Saved ${new URL(body.url).hostname}`, url: body.url, kind: kindOf(body.url), folder: folderId ? { id: folderId, order } : null });
    items = [made, ...items];
    return r.fulfill({ status: 201, json: made });
  });
  await page.route("**/api/later-queue/order", r => {
    queueOrders.push(FolderOrderSchema.parse(r.request().postDataJSON()).ids);
    return r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/later-playlist", r => {
    const body = SaveSchema.parse(r.request().postDataJSON());
    saves.push(body);
    const made = ["one", "two", "three"].map((v, n) => item({ id: `pl-${v}`, title: `Lecture ${n + 1}`, url: `https://www.youtube.com/watch?v=${v}`, kind: "watch", folder: body.folderId ? { id: body.folderId, order: 3 + n } : null }));
    items = [...made, ...items];
    return r.fulfill({ status: 201, json: { saved: made, failed: [{ url: "https://www.youtube.com/watch?v=gone", error: "Video unavailable" }] } satisfies SaveOutcome });
  });
  await page.route("**/api/later-folders", r => {
    if (r.request().method() !== "POST") return r.fulfill({ json: folders });
    const made = { id: `f${folders.length + 1}`, name: FolderNameSchema.parse(r.request().postDataJSON()).name, createdAt: Date.now() };
    folders = [...folders, made];
    return r.fulfill({ status: 201, json: made });
  });
  await page.route("**/api/later-folders/*/*", r => {
    const [id = "", action] = new URL(r.request().url()).pathname.split("/").slice(-2);
    if (action === "order") {
      const { ids } = FolderOrderSchema.parse(r.request().postDataJSON());
      orders.push(ids);
      items = items.map(i => (i.folder?.id === id ? { ...i, folder: { id, order: ids.indexOf(i.id) + 1 } } : i));
      return r.fulfill({ json: { ok: true } });
    }
    if (action === "delete") {
      const back = items.filter(i => i.folder?.id === id).map(i => ({ ...i, folder: null, state: "unread" as const, worth: "unscored" as const }));
      items = items.map(i => back.find(b => b.id === i.id) ?? i);
      folders = folders.filter(f => f.id !== id);
      return r.fulfill({ json: back });
    }
    const renamed = folders.find(f => f.id === id);
    if (!renamed) return r.fulfill({ status: 404, json: { error: "no such folder" } });
    folders = folders.map(f => (f.id === id ? { ...f, ...FolderNameSchema.parse(r.request().postDataJSON()) } : f));
    return r.fulfill({ json: folders.find(f => f.id === id) });
  });
  await page.route("**/api/later/*/folder", r => {
    const id = new URL(r.request().url()).pathname.split("/").at(-2) ?? "";
    const { folderId } = MoveSchema.parse(r.request().postDataJSON());
    items = items.map(i => (i.id !== id ? i : folderId ? { ...i, folder: { id: folderId, order: 99 } } : { ...i, folder: null, state: "unread", worth: "unscored" }));
    return r.fulfill({ json: items.find(i => i.id === id) });
  });
  await page.routeWebSocket("**/ws", ws => ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage)));
  return { saves, orders, queueOrders };
}

const pasteBox = (page: Page) => page.getByRole("textbox", { name: "paste links to save, or type to filter" });
const folderList = (page: Page, name = RLS.name) => page.getByRole("list", { name: `folder ${name}` });
const toggle = (page: Page) => page.getByRole("radiogroup", { name: "read or watch" });

test("pasting comma separated links saves each one and names the link that failed", async ({ page }) => {
  const hub = await fakeHub(page);
  await page.goto("/content");
  await pasteBox(page).fill("https://a.dev/1, https://broken.dev/x,https://b.dev/2");
  await expect(page.getByText("↵ save 3")).toBeVisible();
  await pasteBox(page).press("Enter");
  await expect(page.getByText(/saved 2, 1 failed: https:\/\/broken\.dev\/x/)).toBeVisible();
  expect(hub.saves).toEqual([{ url: "https://a.dev/1" }, { url: "https://broken.dev/x" }, { url: "https://b.dev/2" }]);
  await expect(page.getByRole("list", { name: "read later" }).getByRole("listitem")).toHaveCount(3);
});

test("opening a folder clears read and watch, lists both kinds in order, and links pasted there land in it", async ({ page }) => {
  const hub = await fakeHub(page);
  await page.goto("/content");
  await expect(page.getByRole("list", { name: "read later" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("complementary", { name: "later sidebar" }).getByRole("button", { name: /rls deep dive/ }).click();
  await expect(page).toHaveURL(/\/content\/folder\/rls$/);
  await expect(toggle(page).getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(folderList(page).getByRole("listitem")).toHaveText([/01.*Row security policies/, /02.*RLS in ten minutes/]);
  await expect(page.getByText("2 items · 20 min")).toBeVisible();

  const box = page.getByPlaceholder("paste links to save into rls deep dive, or type to filter");
  await box.fill("https://pg.dev/rls, https://www.youtube.com/watch?v=abc");
  await box.press("Enter");
  await expect(folderList(page).getByRole("listitem")).toHaveCount(4);
  expect(hub.saves).toEqual([
    { url: "https://pg.dev/rls", folderId: "rls" },
    { url: "https://www.youtube.com/watch?v=abc", folderId: "rls" },
  ]);
  await expect(page).toHaveURL(/\/content\/folder\/rls$/);

  await box.press("Escape");
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/\/content\/watch$/);
  await expect(toggle(page).getByRole("radio", { name: /watch/ })).toBeChecked();
});

test("a pasted youtube playlist becomes one item per video, in a folder too", async ({ page }) => {
  const hub = await fakeHub(page);
  await page.goto("/content/folder/rls");
  const box = page.getByPlaceholder("paste links to save into rls deep dive, or type to filter");
  await box.fill("https://www.youtube.com/playlist?list=PLabc");
  await box.press("Enter");
  await expect(folderList(page).getByRole("listitem")).toHaveText([/Row security policies/, /RLS in ten minutes/, /Lecture 1/, /Lecture 2/, /Lecture 3/]);
  await expect(page.getByText(/saved 3, 1 failed: https:\/\/www\.youtube\.com\/watch\?v=gone \(Video unavailable\)/)).toBeVisible();
  expect(hub.saves).toEqual([{ url: "https://www.youtube.com/playlist?list=PLabc", folderId: "rls" }]);
});

test("dragging a row reorders a folder, and the queue outside folders too", async ({ page }) => {
  const hub = await fakeHub(page);
  await page.goto("/content/folder/rls");
  const rows = folderList(page).getByRole("listitem");
  await rows.filter({ hasText: "RLS in ten minutes" }).dragTo(rows.filter({ hasText: "Row security policies" }), { targetPosition: { x: 40, y: 4 } });
  await expect(rows).toHaveText([/01.*RLS in ten minutes/, /02.*Row security policies/]);
  expect(hub.orders).toEqual([["talk", "policies"]]);

  await page.goto("/content/read");
  await pasteBox(page).fill("https://a.dev/1");
  await pasteBox(page).press("Enter");
  const queue = page.getByRole("list", { name: "read later" }).getByRole("listitem");
  await expect(queue).toHaveText([/Saved a\.dev/, /Building effective agents/]);
  await queue.filter({ hasText: "Building effective agents" }).dragTo(queue.filter({ hasText: "Saved a.dev" }), { targetPosition: { x: 40, y: 4 } });
  await expect(queue).toHaveText([/Building effective agents/, /Saved a\.dev/]);
  expect(hub.queueOrders).toEqual([["agents", "new1"]]);
});

test("items in a folder have no done or archive, reorder with J and K, and u sends one back to the queue", async ({ page }) => {
  const hub = await fakeHub(page);
  await page.goto("/content/folder/rls");
  await folderList(page).getByRole("listitem").filter({ hasText: "Row security policies" }).click();
  const pane = page.getByRole("region", { name: "Row security policies" });
  await expect(pane.getByRole("button", { name: "mark done (e)" })).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "archive (#)" })).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "move to folder (g)" })).toHaveText("rls deep dive");
  await pane.getByRole("button", { name: /next in folder: RLS in ten minutes/ }).click();
  await expect(folderList(page).getByRole("listitem").filter({ hasText: "RLS in ten minutes" })).toHaveAttribute("aria-current", "true");

  await page.keyboard.press("Shift+K");
  await expect(folderList(page).getByRole("listitem")).toHaveText([/01.*RLS in ten minutes/, /02.*Row security policies/]);
  expect(hub.orders).toEqual([["talk", "policies"]]);

  await page.keyboard.press("u");
  await expect(folderList(page).getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("2");
  await expect(page.getByRole("list", { name: "watch later" }).getByRole("listitem").filter({ hasText: "RLS in ten minutes" })).toBeVisible();
});

test("g moves an ungrouped item into a new folder, and deleting that folder hands it back", async ({ page }) => {
  await fakeHub(page);
  await page.goto("/content");
  await page.getByRole("list", { name: "read later" }).getByRole("listitem").filter({ hasText: "Building effective agents" }).click();
  await page.keyboard.press("g");
  const menu = page.getByRole("menu", { name: "move to folder" });
  await menu.getByRole("menuitem", { name: "new folder" }).click();
  await menu.getByRole("textbox", { name: "new folder name" }).fill("agents");
  await menu.getByRole("textbox", { name: "new folder name" }).press("Enter");
  await expect(page.getByRole("list", { name: "read later" })).toHaveCount(0);
  await expect(page.getByText("nothing to read here", { exact: false })).toBeVisible();

  await page.getByRole("complementary", { name: "later sidebar" }).getByRole("button", { name: /^agents/ }).click();
  await expect(folderList(page, "agents").getByRole("listitem")).toHaveText([/Building effective agents/]);
  await page.getByRole("button", { name: "delete" }).click();
  await expect(page.getByText("delete the folder? its 1 items go back to the queue as unread")).toBeVisible();
  await page.getByRole("button", { name: "delete" }).first().click();
  await expect(page).toHaveURL(/\/content$/);
  await expect(page.getByRole("list", { name: "read later" }).getByRole("listitem").filter({ hasText: "Building effective agents" })).toBeVisible();
});
