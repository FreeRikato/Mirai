import { expect, test, type Page } from "@playwright/test";
import type { ServerMessage } from "../src/shared/schema";
import { HighlightNoteSchema, NewHighlightSchema, PatchSchema, ProgressSchema, SaveSchema, SendSchema, type Highlight, type LaterItem, type LaterReader, type Skip, type Transcript, type WorthSnapshot } from "../src/shared/later";
import type { Social } from "../src/shared/social";
import type { CitationCheck, MiraiEvent } from "../src/shared/mirai";
import { events, fleet, miraiThread, miraiTurn, mockMirai } from "./fixtures";

const DAY = 86_400_000;

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
  savedAt: Date.now() - 3 * DAY,
  queueOrder: over.savedAt ?? Date.now() - 3 * DAY,
  ...over,
});

const ITEMS: LaterItem[] = [
  item({ id: "rls", title: "How Postgres RLS evaluates policies", site: "pganalyze.com", lengthSec: 840, progress: 0.4, position: 0.4, state: "progress", tldr: ["Policies are inlined into the plan before planning."] }),
  item({ id: "agents", title: "Building effective agents", site: "anthropic.com", lengthSec: 3000, worth: "skim" }),
  item({ id: "tweet", title: "Karpathy on vibe coding", site: "x.com", url: "https://x.com/karpathy/status/1", lengthSec: null, embed: { type: "external", reason: "x.com doesn't allow embedding" }, worth: "archive", tldr: ["Give in to the vibes."] }),
  item({ id: "old", title: "Why your share target isn't firing", site: "web.dev", worth: "unscored", savedAt: Date.now() - 40 * DAY }),
  item({
    id: "talk",
    title: "Intro to Large Language Models",
    kind: "watch",
    site: "youtube.com",
    url: "https://www.youtube.com/watch?v=zjkBMFhNj_g",
    embed: { type: "youtube", videoId: "zjkBMFhNj_g" },
    lengthSec: 3588,
    chapters: [
      { at: 0, title: "Intro" },
      { at: 20, title: "LLM Inference" },
      { at: 257, title: "LLM Training" },
    ],
  }),
];

const READER = `<h2>The rewrite happens first</h2>${"<p>Each table with RLS gets its USING clause attached as a security barrier qualifier before the planner runs.</p>".repeat(80)}`;

const RANKED: WorthSnapshot = {
  kind: "ready",
  rankedAt: Date.now(),
  costUsd: 0.001,
  more: 0,
  unranked: 1,
  items: [
    { id: "agents", title: "Building effective agents", score: 2.8, reason: "ship now", verdict: "full", evidence: ["anthropic.com", "50 min", "saved 3d ago"] },
    { id: "rls", title: "How Postgres RLS evaluates policies", score: 1.6, reason: "deep skill", verdict: "skim", evidence: ["pganalyze.com", "14 min", "40% read", "saved 3d ago"] },
  ],
};

async function mockLater(page: Page, worth: WorthSnapshot = RANKED) {
  let items = ITEMS;
  const saved: string[] = [];
  const patches: unknown[] = [];
  const progress: { id: string; progress: number }[] = [];
  const sent: unknown[] = [];
  const rankings: string[] = [];
  let ranked = worth;

  await page.route("**/api/later-worth/read", r => r.fulfill({ json: ranked }));
  await page.route("**/api/later-worth/watch", r => r.fulfill({ json: { kind: "unranked" } satisfies WorthSnapshot }));
  await page.route("**/api/later-worth/*/refresh", r => {
    rankings.push(r.request().url().split("/").at(-2) ?? "");
    ranked = RANKED;
    return r.fulfill({ json: ranked });
  });
  await page.route("**/api/fleet", r => r.fulfill({ json: fleet }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ status: 404, body: "" }));
  await page.route("**/api/later", r => {
    if (r.request().method() !== "POST") return r.fulfill({ json: items });
    const { url } = SaveSchema.parse(r.request().postDataJSON());
    saved.push(url);
    const created = item({ id: "new", title: "Memory Allocation", url, site: "samwho.dev", savedAt: Date.now() });
    items = [created, ...items];
    return r.fulfill({ status: 201, json: created });
  });
  await page.route("**/api/later/*/reader", r => r.fulfill({ json: { kind: "ready", html: READER, words: 1500 } satisfies LaterReader }));
  await page.route("**/api/later/*/update", r => {
    const id = r.request().url().split("/").at(-2) ?? "";
    const body = PatchSchema.parse(r.request().postDataJSON());
    patches.push({ id, ...body });
    items = items.map(i => (i.id === id ? { ...i, ...body } : i));
    return r.fulfill({ json: items.find(i => i.id === id) });
  });
  await page.route("**/api/later/*/progress", r => {
    const id = r.request().url().split("/").at(-2) ?? "";
    const body = ProgressSchema.parse(r.request().postDataJSON());
    progress.push({ id, progress: body.progress });
    return r.fulfill({ json: items.find(i => i.id === id) });
  });
  await page.route("**/api/later/*/transcript", r => r.fulfill({ json: { status: "queued" } satisfies Transcript }));
  await page.route("**/api/later/*/send", r => {
    sent.push({ id: r.request().url().split("/").at(-2), ...SendSchema.parse(r.request().postDataJSON()) });
    return r.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket("**/ws", ws => ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage)));
  return { saved, patches, progress, sent, rankings };
}

const list = (page: Page, kind: "read" | "watch" = "read") => page.getByRole("list", { name: `${kind} later` });
const entry = (page: Page, text: string, kind: "read" | "watch" = "read") => list(page, kind).getByRole("listitem").filter({ hasText: text });

test("the later tab is now content at /content, with a read and watch toggle", async ({ page }) => {
  await mockLater(page);
  await page.goto("/machines");
  const nav = page.getByRole("navigation", { name: "modules" });
  await expect(nav.getByText("read later")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "later" })).toHaveCount(0);
  await nav.getByRole("link", { name: "content" }).click();
  await expect(page).toHaveURL(/\/content$/);

  const toggle = page.getByRole("radiogroup", { name: "read or watch" });
  await expect(toggle.getByRole("radio", { name: /read/ })).toContainText("4");
  await expect(list(page).getByRole("listitem")).toHaveCount(4);
  await toggle.getByRole("radio", { name: /watch/ }).click();
  await expect(page).toHaveURL(/\/content\/watch$/);
  await expect(entry(page, "Intro to Large Language Models", "watch")).toContainText("59:48");
  await page.keyboard.press("1");
  await expect(page).toHaveURL(/\/content$/);
});

test("rows carry length, progress, jev's verdict and flag stale or external items", async ({ page }) => {
  await mockLater(page);
  await page.goto("/later");
  await expect(entry(page, "How Postgres RLS")).toContainText("14 min");
  await expect(entry(page, "How Postgres RLS")).toContainText("40%");
  await expect(entry(page, "How Postgres RLS")).toContainText("Policies are inlined");
  await expect(entry(page, "Building effective agents")).toContainText("skim");
  await expect(entry(page, "How Postgres RLS")).toContainText("read fully");
  await expect(entry(page, "Why your share target")).not.toContainText(/fully|skim|summary|archive/);
  await expect(entry(page, "Karpathy")).toContainText("external");
  const letGo = page.getByRole("region", { name: "still want these?" });
  await expect(letGo).toContainText("1 unread for over 30 days");
  await expect(letGo).toContainText("1 jev says to archive");
  await expect(letGo.getByRole("button", { name: "archive all 2" })).toBeVisible();
});

test("worth your time ranks the queue for me, and a pick opens the item with the facts behind it", async ({ page }) => {
  await mockLater(page);
  await page.goto("/later");
  const sidebar = page.getByRole("complementary", { name: "later sidebar" });
  const section = sidebar.getByRole("region", { name: "worth your time" });
  await expect(section).toContainText("2 ranked");
  await expect(section).toContainText("+ 1 unranked");
  const rows = section.getByRole("button", { name: /Building effective agents|How Postgres RLS/ });
  await expect(rows).toHaveText([/Building effective agents.*ship now.*read fully/, /How Postgres RLS.*deep skill.*skim/]);
  await expect(section.getByRole("img", { name: "worth 2.8 of 3" })).toBeVisible();

  await sidebar.getByRole("button", { name: /≤ 10 min/ }).click();
  await expect(entry(page, "Building effective agents")).toHaveCount(0);
  await section.getByRole("button", { name: /Building effective agents/ }).click();

  await expect(entry(page, "Building effective agents")).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("region", { name: "Building effective agents" })).toBeVisible();
  const picked = section.getByRole("button", { name: /Building effective agents/ });
  await expect(picked).toHaveAttribute("aria-pressed", "true");
  await expect(picked.getByLabel("why")).toHaveText(/anthropic.com.*50 min.*saved 3d ago/);
});

test("worth your time waits for ↻ and ranks only the tab on screen", async ({ page }) => {
  const hub = await mockLater(page, { kind: "unranked" });
  await page.goto("/later");
  const section = page.getByRole("region", { name: "worth your time" });
  await expect(section).toContainText("press ↻ to rank what to read next");
  expect(hub.rankings).toEqual([]);
  await section.getByRole("button", { name: "rank read later again" }).click();
  await expect(section).toContainText("2 ranked");
  expect(hub.rankings).toEqual(["read"]);
});

test("time budget, source and text filters narrow the list", async ({ page }) => {
  await mockLater(page);
  await page.goto("/later");
  const sidebar = page.getByRole("complementary", { name: "later sidebar" });
  await sidebar.getByRole("button", { name: /≤ 10 min/ }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
  await sidebar.getByRole("button", { name: /^any/ }).click();
  await sidebar.getByRole("button", { name: /pganalyze.com/ }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await sidebar.getByRole("button", { name: /pganalyze.com/ }).click();
  await page.keyboard.press("/");
  await page.keyboard.type("share target");
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(list(page).getByRole("listitem")).toContainText("Why your share target");
});

test("pasting a link and pressing enter saves it and opens it", async ({ page }) => {
  const hub = await mockLater(page);
  await page.goto("/later");
  const box = page.getByRole("textbox", { name: "paste links to save, or type to filter" });
  await box.fill("https://samwho.dev/memory-allocation/");
  await expect(page.getByText("↵ save")).toBeVisible();
  await box.press("Enter");
  await expect(entry(page, "Memory Allocation")).toHaveAttribute("aria-current", "true");
  expect(hub.saved).toEqual(["https://samwho.dev/memory-allocation/"]);
  await expect(box).toHaveValue("");
});

test("the share sheet still works from the old /later address, saves the shared link and lands on /content", async ({ page }) => {
  const hub = await mockLater(page);
  await page.goto(`/later?title=Memory&text=${encodeURIComponent("look at this https://samwho.dev/memory-allocation/")}`);
  await expect(entry(page, "Memory Allocation")).toBeVisible();
  expect(hub.saved).toEqual(["https://samwho.dev/memory-allocation/"]);
  await expect(page).toHaveURL(/\/content$/);
});

test("an article opens in the reader view and just looking at it never marks it done", async ({ page }) => {
  const hub = await mockLater(page);
  await page.goto("/later");
  await entry(page, "Building effective agents").click();
  const reader = page.frameLocator('iframe[title="Building effective agents (reader view)"]');
  await expect(reader.getByRole("heading", { name: "The rewrite happens first" })).toBeVisible();
  await page.getByRole("button", { name: "larger text" }).click();
  await expect(page.getByText("18px")).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.getByRole("region", { name: "Karpathy on vibe coding" })).toBeVisible();
  expect(hub.progress.filter(p => p.progress >= 0.97)).toEqual([]);
});

test("a site that blocks embedding offers send to machine or a new tab", async ({ page }) => {
  const hub = await mockLater(page);
  await page.goto("/later");
  await entry(page, "Karpathy").click();
  const pane = page.getByRole("region", { name: "Karpathy on vibe coding" });
  await expect(pane.getByText("x.com doesn't allow embedding")).toBeVisible();
  await expect(pane.getByRole("link", { name: /new tab here/ })).toHaveAttribute("href", "https://x.com/karpathy/status/1");
  await pane.getByRole("button", { name: /send to macato/ }).first().click();
  await expect(pane.getByText("opened on macato").first()).toBeVisible();
  expect(hub.sent).toEqual([{ id: "tweet", machine: "macato" }]);
});

test("in the done queue the done button puts an item back to unread", async ({ page }) => {
  const hub = await mockLater(page);
  await page.goto("/later");
  await entry(page, "Why your share target").click();
  await page.keyboard.press("e");
  await expect(entry(page, "Why your share target")).toHaveCount(0);

  await page.getByLabel("ungrouped", { exact: true }).getByRole("button", { name: /^done/ }).click();
  await entry(page, "Why your share target").click();
  await expect(page.getByRole("button", { name: "mark done (e)" })).toHaveCount(0);
  await page.getByRole("button", { name: "mark unread (e)" }).click();
  await expect(entry(page, "Why your share target")).toHaveCount(0);
  expect(hub.patches).toEqual([
    { id: "old", state: "done" },
    { id: "old", state: "unread" },
  ]);
});

test("the queue list has no in progress section; half-read items sit in unread", async ({ page }) => {
  await mockLater(page);
  await page.goto("/later");
  await expect(page.getByLabel("ungrouped", { exact: true }).getByRole("button")).toHaveText([/^unread/, /^done/, /^archived/]);
  await expect(entry(page, "How Postgres RLS")).toBeVisible();
});

test("e marks done and # archives, moving on to the next item", async ({ page }) => {
  const hub = await mockLater(page);
  await page.goto("/later");
  await entry(page, "How Postgres RLS").click();
  await page.keyboard.press("e");
  await expect(entry(page, "How Postgres RLS")).toHaveCount(0);
  await expect(entry(page, "Building effective agents")).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("#");
  await expect(entry(page, "Building effective agents")).toHaveCount(0);
  expect(hub.patches).toEqual([
    { id: "rls", state: "done" },
    { id: "agents", state: "archived" },
  ]);
});

test("watch shows chapters and speed controls, and f enters a focus session with up next", async ({ page }) => {
  await mockLater(page);
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  const chapters = page.getByRole("list", { name: "chapters" });
  await expect(chapters.getByRole("button")).toHaveCount(3);
  await expect(chapters.getByRole("button", { name: /LLM Training/ })).toContainText("4:17");
  await expect(page.getByText("could not load the YouTube player")).toBeVisible();
  const speed = page.getByRole("button", { name: "speed" });
  await expect(speed).toHaveText("1x");
  await speed.click();
  await page.getByRole("menu", { name: "speeds" }).getByRole("menuitemradio", { name: "3x" }).click();
  await expect(speed).toHaveText("3x");
  await page.keyboard.press(".");
  await expect(speed).toHaveText("3.5x");

  await page.keyboard.press("f");
  await expect(page.getByRole("complementary", { name: "up next" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "later sidebar" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "later sidebar" })).toBeVisible();
});

const FAKE_YT = `
window.YT = { Player: class {
  constructor(el, opts) { this.opts = opts; this.t = opts.playerVars.start; this.state = -1; this.muted = false; this.rate = 1; this.unloaded = []; window.fakeYt = this; setTimeout(() => opts.events.onReady({ target: this, data: 0 })); }
  playVideo() { this.state = 1; } pauseVideo() { this.state = 2; } seekTo(t) { this.t = t; }
  getCurrentTime() { return this.t; } getDuration() { return 3588; } getPlayerState() { return this.state; }
  setPlaybackRate(r) { this.rate = r; } mute() { this.muted = true; } unMute() { this.muted = false; } isMuted() { return this.muted; } unloadModule(m) { this.unloaded.push(m); } destroy() {}
  getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; }
} };
window.onYouTubeIframeAPIReady();
`;

type FakeYt = { state: number; muted: boolean; rate: number; t: number; unloaded: string[]; opts: { playerVars: Record<string, number> } };

const seekYt = (page: Page, t: number) =>
  page.evaluate(sec => {
    (window as unknown as { fakeYt: FakeYt }).fakeYt.t = sec;
  }, t);
const ytTime = (page: Page) => page.evaluate(() => (window as unknown as { fakeYt: FakeYt }).fakeYt.t);

const HEARD: Transcript = {
  status: "ready",
  model: "parakeet-tdt-0.6b-v2-fp16 cuda",
  segments: [
    { start: 0.4, end: 4, text: "Hi everyone." },
    { start: 20, end: 26, text: "So let's talk about inference. It is just two files." },
    { start: 257, end: 262, text: "Training is a lot more involved." },
  ],
};

test("watch draws its own controls over a chrome-less youtube player", async ({ page }) => {
  await mockLater(page);
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  const yt = () =>
    page.evaluate((): FakeYt => {
      const { state, muted, rate, t, unloaded, opts } = (window as unknown as { fakeYt: FakeYt }).fakeYt;
      return { state, muted, rate, t, unloaded, opts: { playerVars: opts.playerVars } };
    });
  const overlay = page.getByTestId("player-overlay");

  await expect(overlay.getByRole("button", { name: "play", exact: true })).toHaveCount(2);
  expect((await yt()).opts.playerVars).toMatchObject({ controls: 0, disablekb: 1 });
  expect((await yt()).unloaded).toContain("captions");

  await overlay.getByRole("button", { name: "play", exact: true }).first().click();
  await expect(overlay.getByRole("button", { name: "pause" })).toBeVisible();
  await expect(overlay.getByRole("button", { name: "play", exact: true })).toHaveCount(0);

  await page.keyboard.press("m");
  await expect(overlay.getByRole("button", { name: "unmute" })).toBeVisible();
  expect((await yt()).muted).toBe(true);

  await overlay.getByRole("button", { name: "speed" }).click();
  const speeds = overlay.getByRole("menu", { name: "speeds" });
  await expect(speeds.getByRole("menuitemradio", { name: "3x" })).toBeDisabled();
  await expect(speeds).toContainText("max 2x here");
  await speeds.getByRole("menuitemradio", { name: "2x" }).click();
  expect((await yt()).rate).toBe(2);
  await page.keyboard.press(".");
  await expect(overlay.getByRole("button", { name: "speed" })).toHaveText("2x");

  const bar = overlay.getByRole("slider", { name: "seek" });
  const box = await bar.boundingBox();
  if (!box) throw new Error("seek bar has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(overlay.getByText("29:54 LLM Training")).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect((await yt()).t).toBeCloseTo(1794, 0);

  await overlay.click({ position: { x: 40, y: 40 } });
  await expect.poll(async () => (await yt()).state).toBe(2);
  await expect(overlay.getByRole("button", { name: "play", exact: true })).toHaveCount(2);
});

test("n takes a note at the current moment, and the note seeks back there", async ({ page }) => {
  await mockLater(page);
  const hub = await mockHighlights(page);
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  await expect(page.getByRole("tab", { name: "chapters 3" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("player-overlay").getByRole("button", { name: "play", exact: true })).toHaveCount(2);
  await page.evaluate(() => {
    (window as unknown as { fakeYt: FakeYt }).fakeYt.t = 892;
  });

  await page.keyboard.press("n");
  await expect(page.getByRole("tab", { name: "notes" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "note at this moment" })).toBeFocused();
  await page.keyboard.type("batching across racks");
  await page.keyboard.press("Enter");
  expect(hub.writes).toEqual([{ path: "add", body: { quote: "14:52", prefix: "", suffix: "", note: "batching across racks", at: 892 } }]);

  const notes = page.getByRole("list", { name: "notes" });
  await expect(notes).toContainText("14:52batching across racks");
  await expect(page.getByRole("tab", { name: "notes 1" })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { fakeYt: FakeYt }).fakeYt.t = 0;
  });
  await notes.getByRole("button", { name: "play from 14:52" }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { fakeYt: FakeYt }).fakeYt.t)).toBe(892);
});

test("the transcript follows the video, a line jumps there, and c shows it as subtitles", async ({ page }) => {
  await mockLater(page);
  await page.route("**/api/later/*/transcript", r => r.fulfill({ json: HEARD }));
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  await expect(page.getByTestId("player-overlay").getByRole("button", { name: "play", exact: true })).toHaveCount(2);
  await seekYt(page, 21);

  await page.getByRole("tab", { name: "transcript" }).click();
  const lines = page.getByRole("list", { name: "transcript" });
  await expect(lines.getByRole("button")).toHaveText(["0:00Hi everyone.", "0:20So let's talk about inference. It is just two files.here", "4:17Training is a lot more involved."]);
  await expect(lines.locator("[aria-current]")).toContainText("0:20");

  await lines.getByRole("button", { name: /4:17/ }).click();
  await expect.poll(() => ytTime(page)).toBe(257);
  await expect(lines.locator("[aria-current]")).toContainText("4:17");

  const subtitle = page.getByTestId("subtitle");
  await expect(subtitle).toHaveCount(0);
  await page.keyboard.press("c");
  await expect(page.getByTestId("player-overlay").getByRole("button", { name: "subtitles off (c)" })).toHaveAttribute("aria-pressed", "true");
  await expect(subtitle).toHaveText("Training is a lot more involved.");
  await seekYt(page, 21);
  await expect(subtitle).toHaveText("So let's talk about inference.");
  await seekYt(page, 100);
  await expect(subtitle).toHaveCount(0);
  await page.keyboard.press("c");
  await seekYt(page, 21);
  await expect(page.getByTestId("player-overlay").getByRole("button", { name: "subtitles on (c)" })).toHaveAttribute("aria-pressed", "false");
  await expect(subtitle).toHaveCount(0);
});

test("playing into a sponsor segment skips it, marks it on the bar, and undo plays it", async ({ page }) => {
  await mockLater(page);
  await page.route("**/api/later/*/skips", r => r.fulfill({ json: [{ start: 20, end: 50, category: "sponsor" }] satisfies Skip[] }));
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  const overlay = page.getByTestId("player-overlay");
  await expect(overlay.getByRole("button", { name: "play", exact: true })).toHaveCount(2);
  await expect(page.getByTestId("skip-mark")).toHaveCount(1);

  await seekYt(page, 30);
  await expect(overlay.getByText(/^0:30/)).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);

  await seekYt(page, 19.2);
  await expect(overlay.getByText(/^0:19/)).toBeVisible();
  await seekYt(page, 20.2);
  await expect.poll(() => ytTime(page)).toBe(50);
  await expect(page.getByRole("status")).toHaveText("skipped sponsor 0:30undo");

  await page.getByRole("status").getByRole("button", { name: "undo" }).click();
  await expect.poll(() => ytTime(page)).toBe(20);
  await seekYt(page, 20.3);
  await expect(overlay.getByText(/^0:20/)).toBeVisible();
  await seekYt(page, 21.2);
  await expect(overlay.getByText(/^0:21/)).toBeVisible();
  expect(await ytTime(page)).toBe(21.2);
});

test("the transcript keeps the line being played in view as the video moves on", async ({ page }) => {
  await mockLater(page);
  const segments = Array.from({ length: 200 }, (_, i) => ({ start: i * 10, end: i * 10 + 8, text: `line number ${i}` }));
  await page.route("**/api/later/*/transcript", r => r.fulfill({ json: { status: "ready", model: "parakeet", segments } satisfies Transcript }));
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  await page.getByRole("tab", { name: "transcript" }).click();
  const lines = page.getByRole("list", { name: "transcript" });
  await expect(lines.getByRole("button", { name: /line number 199/ })).toBeAttached();
  await seekYt(page, 1502);
  await expect(lines.locator("[aria-current]")).toContainText("line number 150");
  await expect(lines.locator("[aria-current]")).toBeInViewport();
  await seekYt(page, 305);
  await expect(lines.locator("[aria-current]")).toContainText("line number 30");
  await expect(lines.locator("[aria-current]")).toBeInViewport();
});

test("while a video is transcribed, a progress bar tops the lines heard so far, which grow, and subtitles already work", async ({ page }) => {
  await mockLater(page);
  const line = (start: number, text: string) => ({ start, end: start + 5, text });
  const stages: Transcript[] = [
    { status: "running", progress: { stage: "downloading", done: 22_359_900, total: 44_719_800 }, segments: [] },
    { status: "running", progress: { stage: "transcribing", done: 1794, total: 3588 }, segments: [line(0.4, "Hi everyone."), line(20, "So let's talk about inference.")] },
    { status: "running", progress: { stage: "transcribing", done: 3229, total: 3588 }, segments: [line(0.4, "Hi everyone."), line(20, "So let's talk about inference."), line(257, "Training is a lot more involved.")] },
  ];
  let calls = 0;
  await page.route("**/api/later/*/transcript", r => r.fulfill({ json: stages[Math.min(calls++, stages.length - 1)] }));
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  await page.getByRole("tab", { name: "transcript" }).click();
  const bar = page.getByRole("progressbar", { name: "transcription progress" });
  const panel = page.getByRole("tabpanel");

  await expect(panel).toContainText("downloading audio 50%");
  await expect(bar).toHaveAttribute("aria-valuenow", "10");

  await expect(panel).toContainText("transcribing 29:54 of 59:48");
  await expect(bar).toHaveAttribute("aria-valuenow", "60");
  const lines = page.getByRole("list", { name: "transcript" });
  await expect(lines.getByRole("button")).toHaveCount(2);

  await seekYt(page, 21);
  await page.keyboard.press("c");
  await expect(page.getByTestId("subtitle")).toHaveText("So let's talk about inference.");

  await expect(panel).toContainText("transcribing 53:49 of 59:48");
  await expect(bar).toHaveAttribute("aria-valuenow", "92");
  await expect(lines.getByRole("button")).toHaveCount(3);
});

test("the transcript tab says when a transcript is on its way, and a failed one can be retried", async ({ page }) => {
  await mockLater(page);
  let transcript: Transcript = { status: "queued" };
  const retried: string[] = [];
  await page.route("**/api/later/*/transcript", r => r.fulfill({ json: transcript }));
  await page.route("**/api/later/*/transcript/retry", r => {
    retried.push(r.request().url().split("/").at(-3) ?? "");
    transcript = { status: "queued" };
    return r.fulfill({ json: transcript });
  });
  await page.goto("/later/watch");
  await entry(page, "Intro to Large", "watch").click();
  await page.getByRole("tab", { name: "transcript" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveText("waiting to be transcribed, this usually takes a minute or two");
  await expect(page.getByTestId("player-overlay").getByRole("button", { name: "subtitles on (c)" })).toBeDisabled();

  transcript = { status: "failed", error: "ERROR: [youtube] zjkBMFhNj_g: Sign in to confirm you're not a bot", retryAt: null };
  await page.reload();
  await entry(page, "Intro to Large", "watch").click();
  await page.getByRole("tab", { name: "transcript" }).click();
  await expect(panel).toContainText("transcribing failed: ERROR: [youtube] zjkBMFhNj_g: Sign in to confirm you're not a bot");
  await panel.getByRole("button", { name: "retry" }).click();
  await expect(panel).toHaveText("waiting to be transcribed, this usually takes a minute or two");
  expect(retried).toEqual(["talk"]);
});

test("switching between read and watch keeps what was open in each", async ({ page }) => {
  await mockLater(page);
  await page.goto("/later");
  await entry(page, "Building effective agents").click();
  await expect(page.getByRole("region", { name: "Building effective agents" })).toBeVisible();
  await page.getByRole("radio", { name: /watch/ }).click();
  await expect(page.getByText("pick something from the list")).toBeVisible();
  await entry(page, "Intro to Large", "watch").click();
  await expect(page.getByRole("region", { name: "Intro to Large Language Models" })).toBeVisible();
  await page.getByRole("radio", { name: /read/ }).click();
  await expect(page.getByRole("region", { name: "Building effective agents" })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByRole("region", { name: "Intro to Large Language Models" })).toBeVisible();
});

test("⌘K offers to save a pasted link", async ({ page }) => {
  const hub = await mockLater(page);
  await page.goto("/later");
  await expect(page.getByRole("list", { name: "read later" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").getByRole("combobox").fill("https://samwho.dev/memory-allocation/");
  await page.getByRole("option", { name: /save to content: samwho.dev/ }).click();
  await expect(entry(page, "Memory Allocation")).toBeVisible();
  expect(hub.saved).toEqual(["https://samwho.dev/memory-allocation/"]);
});

const SVG = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#333"/></svg>`;

const TWEET: Social = {
  kind: "tweet",
  tweet: {
    id: "1850",
    url: "https://x.com/justsisyphus/status/1850",
    author: { name: "Sisyphus Labs", handle: "justsisyphus", avatar: "https://pbs.twimg.com/avatar.svg" },
    text: "big news soon, stay tuned https://sisyphus.dev/app",
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    media: [
      { type: "image", url: "https://pbs.twimg.com/shot.svg", alt: "the desktop app", width: 800, height: 500 },
      { type: "video", url: "https://video.twimg.com/demo.mp4", hls: null, poster: "https://pbs.twimg.com/poster.svg", width: 1280, height: 720 },
    ],
    quoted: { id: "20", url: "https://x.com/jack/status/20", author: { name: "jack", handle: "jack", avatar: null }, text: "just setting up my twttr", createdAt: "2006-03-21T20:50:14.000Z", media: [], quoted: null, article: null },
    article: null,
  },
};

const THREAD: Social = {
  kind: "reddit",
  thread: {
    url: "https://www.reddit.com/r/rust/comments/abc/async_drop/",
    subreddit: "rust",
    title: "Async drop is here",
    author: "withoutboats",
    score: 812,
    comments: 5,
    createdAt: Date.now() - 5 * 3600_000,
    html: "<div class=\"md\"><p>It finally landed in <a href=\"/r/rust/wiki\">nightly</a>.</p></div>",
    link: null,
    media: [],
    replies: [
      { id: "c1", author: "steveklabnik", html: "<p>Huge, congrats</p>", score: 120, createdAt: Date.now() - 4 * 3600_000, more: 2, replies: [{ id: "c2", author: "withoutboats", html: "<p>thanks!</p>", score: 40, createdAt: Date.now() - 3600_000, more: 0, replies: [] }] },
    ],
    more: 1,
  },
};

async function mockSocial(page: Page, answers: Record<string, Social>) {
  const social = [
    item({ id: "sisyphus", title: "Sisyphus Labs: big news soon", url: "https://x.com/justsisyphus/status/1850", site: "x.com", embed: { type: "social" }, lengthSec: null }),
    item({ id: "asyncdrop", title: "Async drop is here", url: "https://www.reddit.com/r/rust/comments/abc/async_drop/", site: "r/rust", embed: { type: "social" }, lengthSec: null, tldr: ["Async drop landed in nightly."] }),
  ];
  await page.route("**/api/later", r => (r.request().method() === "GET" ? r.fulfill({ json: [...social, ...ITEMS] }) : r.fallback()));
  await page.route("**/api/later/*/social", r => r.fulfill({ json: answers[r.request().url().split("/").at(-2) ?? ""] }));
  await page.route(/https:\/\/(pbs|video)\.twimg\.com\/.*/, r => (r.request().url().endsWith(".svg") ? r.fulfill({ contentType: "image/svg+xml", body: SVG(800, 500) }) : r.fulfill({ contentType: "video/mp4", body: "" })));
}

test("a saved tweet shows its text, photo, video and quoted tweet in the app, and the photo opens in the zoomable preview", async ({ page }) => {
  await mockLater(page);
  await mockSocial(page, { sisyphus: TWEET, asyncdrop: THREAD });
  await page.goto("/later");
  await entry(page, "Sisyphus Labs").click();
  const tweet = page.getByRole("region", { name: "tweet by @justsisyphus" });
  await expect(tweet).toContainText("big news soon, stay tuned");
  await expect(tweet.getByRole("link", { name: "sisyphus.dev/app" })).toHaveAttribute("href", "https://sisyphus.dev/app");
  await expect(tweet.locator("video")).toHaveAttribute("src", `/api/later/media?url=${encodeURIComponent("https://video.twimg.com/demo.mp4")}`);
  await expect(page.getByRole("region", { name: "tweet by @jack" })).toContainText("just setting up my twttr");
  await expect(page.getByText("doesn't allow embedding")).toHaveCount(0);
  await tweet.getByRole("img", { name: "the desktop app" }).click();
  await expect(page.getByRole("dialog", { name: "the desktop app" })).toBeVisible();
});

test("a saved post carrying an X article reads as the article, not as a bare link", async ({ page }) => {
  await mockLater(page);
  const article = {
    id: "2019557885085446144",
    title: "Why OpenClaw's memory sucks",
    cover: null,
    preview: "TLDR: a new plugin",
    html: '<h2>OpenClaw&#39;s memory problems</h2><p>It has a <strong>Two-layer storage</strong> and <a href="https://x.com/i/status/1">a link</a></p><img src="x" onerror="window.pwned=1">',
  };
  const post: Social = { kind: "tweet", tweet: { ...TWEET.tweet, text: "http://x.com/i/article/2019557885085446144", media: [], quoted: null, article } };
  await mockSocial(page, { sisyphus: post, asyncdrop: THREAD });
  await page.goto("/later");
  await entry(page, "Sisyphus Labs").click();
  const body = page.getByRole("region", { name: "article: Why OpenClaw's memory sucks" });
  await expect(body.getByRole("heading", { level: 1, name: "Why OpenClaw's memory sucks" })).toBeVisible();
  await expect(body.getByRole("heading", { level: 2, name: "OpenClaw's memory problems" })).toBeVisible();
  await expect(body.locator("strong")).toHaveText("Two-layer storage");
  await expect(body.getByRole("link", { name: "a link" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "x.com/i/article/2019557885085446144" })).toHaveCount(0);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
});

test("a saved reddit thread shows the post and its comment tree, which folds, with a link for replies reddit held back", async ({ page }) => {
  await mockLater(page);
  await mockSocial(page, { sisyphus: TWEET, asyncdrop: THREAD });
  await page.goto("/later");
  await entry(page, "Async drop is here").click();
  const post = page.getByRole("region", { name: "reddit post" });
  await expect(post.getByRole("heading", { name: "Async drop is here" })).toBeVisible();
  await expect(post.getByRole("link", { name: "nightly" })).toHaveAttribute("href", "https://www.reddit.com/r/rust/wiki");
  const comments = page.getByRole("region", { name: "comments" });
  await expect(comments).toContainText("Huge, congrats");
  await expect(comments).toContainText("thanks!");
  await expect(comments.getByRole("link", { name: "2 more replies on reddit" })).toHaveAttribute("href", "https://www.reddit.com/r/rust/comments/abc/async_drop/c1/");
  await expect(comments.getByRole("link", { name: "1 more reply on reddit" })).toBeVisible();
  const top = comments.getByRole("button", { name: /steveklabnik/ });
  await top.click();
  await expect(top).toHaveAttribute("aria-expanded", "false");
  await expect(comments).not.toContainText("thanks!");
  await expect(top).toContainText("[+2]");
});

test("when reddit can't be read, the thread falls back to open-with and says why", async ({ page }) => {
  await mockLater(page);
  await mockSocial(page, { sisyphus: TWEET, asyncdrop: { kind: "unavailable", reason: "the reddit login expired: paste a fresh reddit_session cookie into MIRAI_REDDIT_SESSION on the hub" } });
  await page.goto("/later");
  await entry(page, "Async drop is here").click();
  await expect(page.getByText("the reddit login expired")).toBeVisible();
  await expect(page.getByRole("link", { name: /new tab here/ })).toHaveAttribute("href", "https://www.reddit.com/r/rust/comments/abc/async_drop/");
});

async function mockHighlights(page: Page) {
  let list: Highlight[] = [];
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/later/*/highlights", r => {
    const itemId = r.request().url().split("/").at(-2) ?? "";
    if (r.request().method() === "GET") return r.fulfill({ json: list.filter(h => h.itemId === itemId) });
    const body = NewHighlightSchema.parse(r.request().postDataJSON());
    writes.push({ path: "add", body });
    const made: Highlight = { ...body, at: body.at ?? null, id: `h${list.length + 1}`, itemId, createdAt: Date.now() };
    list = [...list, made];
    return r.fulfill({ status: 201, json: made });
  });
  await page.route("**/api/later-highlights/*/*", r => {
    const [id, action] = new URL(r.request().url()).pathname.split("/").slice(-2);
    const body: unknown = r.request().postDataJSON();
    writes.push({ path: `${action}:${id}`, body });
    if (action === "delete") list = list.filter(h => h.id !== id);
    else list = list.map(h => (h.id === id ? { ...h, note: HighlightNoteSchema.parse(body).note } : h));
    return r.fulfill({ json: list.find(h => h.id === id) ?? { ok: true } });
  });
  return { writes, list: () => list };
}

const selectText = (page: Page, text: string, within = "article") =>
  page.evaluate(
    ([needle, scope]) => {
      const root = document.querySelector(scope ?? "article");
      if (!root || !needle) throw new Error("no root");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent?.indexOf(needle) ?? -1;
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + needle.length);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        return;
      }
      throw new Error(`no text ${needle}`);
    },
    [text, within],
  );

test("a saved post can use the full width, picked from the toolbar or cycled with w, and the choice sticks", async ({ page }) => {
  await mockLater(page);
  await mockSocial(page, { sisyphus: TWEET, asyncdrop: THREAD });
  await page.goto("/later");
  await entry(page, "Sisyphus Labs: big news soon").click();
  const article = page.locator("article");
  const width = () => article.evaluate(el => el.getBoundingClientRect().width);
  const pane = await article.evaluate(el => el.parentElement?.getBoundingClientRect().width ?? 0);
  await expect.poll(width).toBeLessThan(700);

  await page.getByRole("button", { name: "full", exact: true }).click();
  await expect.poll(width).toBeGreaterThan(pane - 1);
  await page.reload();
  await entry(page, "Sisyphus Labs: big news soon").click();
  await expect.poll(width).toBeGreaterThan(pane - 1);

  await page.keyboard.press("w");
  await expect.poll(width).toBeLessThan(700);
});

test("text size and find work on a reddit thread, and find walks through the matches", async ({ page }) => {
  await mockLater(page);
  await mockSocial(page, { sisyphus: TWEET, asyncdrop: THREAD });
  await mockHighlights(page);
  await page.goto("/later");
  await entry(page, "Async drop is here").click();
  const article = page.locator("article");
  const before = await article.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.getByRole("button", { name: "larger text" }).click();
  await expect.poll(() => article.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(before + 1);

  await page.getByRole("button", { name: /find in this page/ }).click();
  await page.getByRole("textbox", { name: "find in this page" }).fill("async");
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(article.locator("mark[data-mark=find]")).toHaveCount(2);
  await page.getByRole("textbox", { name: "find in this page" }).press("Enter");
  await expect(page.getByText("2 / 2")).toBeVisible();
  await expect(article.locator("mark[data-mark=find][data-current]")).toHaveText("Async");
  await page.getByRole("textbox", { name: "find in this page" }).press("Escape");
  await expect(article.locator("mark[data-mark=find]")).toHaveCount(0);
});

test("select text, highlight it with a note, read the note on hover, then edit and delete it from the pinned card", async ({ page }) => {
  await mockLater(page);
  await mockSocial(page, { sisyphus: TWEET, asyncdrop: THREAD });
  const hub = await mockHighlights(page);
  await page.goto("/later");
  await entry(page, "Async drop is here").click();
  await expect(page.getByRole("region", { name: "comments" })).toContainText("Huge, congrats");
  await expect(page.getByRole("button", { name: /highlight the selected text/ })).toBeDisabled();

  await selectText(page, "Huge, congrats");
  await page.getByRole("button", { name: "highlight", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "highlight" });
  await expect(dialog).toContainText("Huge, congrats");
  await dialog.getByRole("textbox", { name: "note" }).fill("the tone of the thread");
  await dialog.getByRole("button", { name: "save" }).click();
  await expect.poll(() => hub.writes).toEqual([{ path: "add", body: expect.objectContaining({ quote: "Huge, congrats", note: "the tone of the thread" }) }]);

  const mark = page.locator("article mark[data-mark=hl]");
  await expect(mark).toHaveText("Huge, congrats");
  await expect(page.getByRole("button", { name: /highlight the selected text/ })).toBeDisabled();
  await expect(page.getByText("1 highlight")).toBeVisible();
  await mark.hover();
  await expect(page.getByRole("tooltip", { name: "highlight note" })).toContainText("the tone of the thread");

  await mark.click();
  const card = page.getByRole("dialog", { name: "highlight note" });
  await expect(card.getByRole("button", { name: "edit note" })).toBeVisible();
  await expect(card.getByText("edit", { exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "edit note" }).click();
  const editor = page.getByRole("dialog", { name: "edit note" });
  await expect(editor.getByRole("textbox", { name: "note" })).toHaveValue("the tone of the thread");
  await editor.getByRole("textbox", { name: "note" }).fill("warm reception");
  await editor.getByRole("textbox", { name: "note" }).press("ControlOrMeta+Enter");
  await expect.poll(() => hub.list()[0]?.note).toBe("warm reception");

  await mark.click();
  await page.getByRole("dialog", { name: "highlight note" }).getByRole("button", { name: "delete highlight" }).click();
  await expect(mark).toHaveCount(0);
  await expect.poll(() => hub.list()).toEqual([]);
});

test("highlights saved earlier come back on the article reader, found by their quote", async ({ page }) => {
  await mockLater(page);
  const hub = await mockHighlights(page);
  await page.route("**/api/later/rls/highlights", r =>
    r.request().method() === "GET" ? r.fulfill({ json: [{ id: "h9", itemId: "rls", quote: "security barrier qualifier", prefix: "USING clause attached as a ", suffix: " before the planner", note: "", at: null, createdAt: Date.now() }] satisfies Highlight[] }) : r.fallback(),
  );
  await page.goto("/later");
  await entry(page, "How Postgres RLS").click();
  const reader = page.frameLocator('iframe[title="How Postgres RLS evaluates policies (reader view)"]');
  await expect(reader.locator("mark[data-mark=hl]").first()).toHaveText("security barrier qualifier");
  expect(hub.writes).toEqual([]);
});

test("asking mirAI with an item open tells it which item you mean", async ({ page }) => {
  await mockLater(page);
  const asked: unknown[] = [];
  await mockMirai(page, {
    ask: async body => {
      asked.push(body);
      return { status: 200, ndjson: [{ type: "error", message: "stubbed" }] };
    },
  });
  await page.goto("/later");
  await entry(page, "How Postgres RLS evaluates policies").click();
  await expect(page.getByRole("region", { name: "How Postgres RLS evaluates policies" })).toBeVisible();
  const mirai = page.getByRole("complementary", { name: "mirAI" });
  await expect(async () => {
    if (!(await mirai.isVisible())) await page.keyboard.press("ControlOrMeta+j");
    await expect(mirai).toBeVisible({ timeout: 500 });
  }).toPass();
  await mirai.getByRole("textbox", { name: "ask mirAI" }).fill("summarise this");
  await page.keyboard.press("Enter");

  await expect.poll(() => asked).toEqual([{ threadId: null, question: "summarise this", view: "content / read · rls · How Postgres RLS evaluates policies" }]);
});

const ytState = (page: Page) => page.evaluate(() => (window as unknown as { fakeYt: FakeYt }).fakeYt.state);

const citedAnswer = (answer: string, citations: CitationCheck[]): MiraiEvent[] => {
  const thread = miraiThread({ turns: [miraiTurn({ question: "where does training start?", view: "content / watch", answer, citations })] });
  return [{ type: "thread", threadId: thread.id }, { type: "text", delta: answer }, { type: "done", thread }];
};

async function askMirai(page: Page, question: string) {
  const panel = page.getByRole("complementary", { name: "mirAI" });
  await expect(async () => {
    if (!(await panel.isVisible())) await page.keyboard.press("ControlOrMeta+j");
    await expect(panel).toBeVisible({ timeout: 500 });
  }).toPass();
  await panel.getByRole("textbox", { name: "ask mirAI" }).fill(question);
  await page.keyboard.press("Enter");
  return panel;
}

test("a mirAI citation opens the video at the cited moment and plays it, again on a second click, and a failed one is not a link", async ({ page }) => {
  await mockLater(page);
  await page.route("https://www.youtube.com/iframe_api", r => r.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  const answer = "Training starts at [▶ 4:17](/content/item/talk?t=257). He never says [▶ 50:00](/content/item/talk?t=3000). Compare [policies inline early](/content/item/rls?q=USING%20clause%20attached%20as%20a). Not [made up here](/content/item/rls?q=a%20quote%20the%20article%20lacks). Later [▶ 0:20](/content/item/talk?t=20).";
  const citations: CitationCheck[] = [
    { key: "talk\nmoment\n257", status: "ok", reason: null },
    { key: "talk\nmoment\n3000", status: "failed", reason: "not in transcript" },
    { key: "rls\npassage\nUSING clause attached as a", status: "ok", reason: null },
    { key: "rls\npassage\na quote the article lacks", status: "failed", reason: "not in the article" },
    { key: "talk\nmoment\n20", status: "unchecked", reason: "transcript not ready" },
  ];
  await mockMirai(page, { ask: async () => ({ status: 200, ndjson: citedAnswer(answer, citations) }) });
  await page.goto("/machines");
  const panel = await askMirai(page, "where does training start?");

  await expect(panel.getByRole("link", { name: "▶ 50:00" })).toHaveCount(0);
  await expect(panel.getByText("not in transcript")).toBeVisible();
  await expect(panel.getByText("made up here ¶")).toBeVisible();
  await expect(panel.getByRole("link", { name: "made up here" })).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "policies inline early ¶" })).toHaveAttribute("href", "/content/item/rls?q=USING%20clause%20attached%20as%20a");
  await expect(panel.getByRole("link", { name: "▶ 0:20" })).toHaveAttribute("title", "not checked: transcript not ready");
  await panel.getByRole("link", { name: "▶ 4:17" }).click();

  await expect(page).toHaveURL(/\/content\/item\/talk\?t=257$/);
  await expect(page.getByRole("region", { name: "Intro to Large Language Models" })).toBeVisible();
  await expect.poll(() => ytTime(page)).toBe(257);
  await expect.poll(() => ytState(page)).toBe(1);
  await expect(panel).toBeVisible();

  await seekYt(page, 900);
  await panel.getByRole("link", { name: "▶ 4:17" }).click();
  await expect.poll(() => ytTime(page)).toBe(257);
});
test("an article citation scrolls to the quoted passage and outlines it until you click elsewhere", async ({ page }) => {
  await mockLater(page);
  await page.route("**/api/later/*/highlights", r => r.fulfill({ json: [] }));
  await page.goto(`/content/item/rls?q=${encodeURIComponent("USING clause attached as a security barrier")}`);
  await expect(page.getByRole("region", { name: "How Postgres RLS evaluates policies" })).toBeVisible();
  const reader = page.frameLocator('iframe[title$="(reader view)"]');
  const cited = reader.locator("mark[data-mark=cite]");
  await expect(cited).toHaveText("USING clause attached as a security barrier");
  await reader.locator("h2").first().click();
  await expect(cited).toHaveCount(0);

  await page.goto("/content/item/gone?t=5");
  await expect(page.getByText("that item was removed")).toBeVisible();
});
