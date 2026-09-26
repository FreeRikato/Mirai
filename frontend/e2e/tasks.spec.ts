import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { buildIndex } from "../src/hub/notes/vaultIndex";
import type { ServerMessage } from "../src/shared/schema";
import { GithubMoveSchema, LocalMoveSchema, type GithubIssue, type GithubSnapshot, type LinearSnapshot, type LocalSnapshot, type LocalTask, type PrioritySnapshot, TaskOrderSchema, type TaskOrder, type TaskOrders } from "../src/shared/tasks";
import { events, fleet } from "./fixtures";

const TODAY = "2026-09-24";

const task = (over: Partial<LocalTask> & Pick<LocalTask, "line" | "title" | "state">): LocalTask => ({
  id: `2026-09-23:${over.line}`,
  date: "2026-09-23",
  raw: `- [${{ open: " ", doing: "/", done: "x", dropped: "-" }[over.state]}] ${over.title}`,
  links: [],
  subtasks: { done: 0, total: 0 },
  block: `- [ ] ${over.title}`,
  ...over,
});

const local: LocalSnapshot = {
  kind: "ready",
  today: TODAY,
  changedAt: Date.now(),
  notes: [
    { date: "2026-09-23", counts: { open: 4, doing: 1, done: 0, dropped: 0 } },
    { date: "2026-09-21", counts: { open: 0, doing: 0, done: 1, dropped: 0 } },
  ],
  tasks: [
    task({
      line: 0,
      title: "Fix the issue",
      state: "open",
      links: [{ kind: "linear", url: "https://linear.app/databrain/issue/DEV-508/x", id: "DEV-508" }],
      subtasks: { done: 1, total: 3 },
      block: "- [ ] Fix the issue - https://linear.app/databrain/issue/DEV-508/x\n\t- [x] editor owns the formatter",
    }),
    task({ line: 4, title: "Review Cursor bot PRs", state: "open" }),
    task({ line: 5, title: "Review sync PRs", state: "doing" }),
    task({
      date: "2026-09-21",
      id: "2026-09-21:2",
      line: 2,
      title: "Understand hasura timeout",
      state: "dropped",
      links: [3862, 3866].map(n => ({ kind: "pr" as const, url: `https://github.com/databrainhq/backend/pull/${n}`, repo: "databrainhq/backend", number: n })),
    }),
  ],
};

const issue = (over: Partial<GithubIssue> & Pick<GithubIssue, "id" | "number" | "title" | "column">): GithubIssue => ({
  repo: "databrainhq/backend",
  url: `https://github.com/databrainhq/backend/issues/${over.number}`,
  body: "## Origin\n\nSee databrainhq/frontend-mono#8276.",
  labels: [{ name: "bug", color: "d73a4a" }],
  author: "linear",
  assignedToMe: true,
  createdByMe: false,
  comments: 1,
  pullRequests: [],
  links: [],
  closedAt: null,
  updatedAt: "2026-09-16T00:00:00Z",
  ...over,
});

const github: GithubSnapshot = {
  kind: "ready",
  fetchedAt: Date.now(),
  issues: [
    issue({ id: "I1", number: 3698, title: "Verify a saved LLM key", column: "open" }),
    issue({ id: "I2", number: 3504, title: "Redis cache hint", column: "progress", assignedToMe: false, createdByMe: true, author: "me", pullRequests: [{ repo: "databrainhq/backend", number: 3877, url: "https://github.com/databrainhq/backend/pull/3877", state: "open" }] }),
  ],
};

const priority: PrioritySnapshot = {
  kind: "ready",
  rankedAt: Date.now(),
  costUsd: 0.0004,
  more: 12,
  unranked: 0,
  items: [
    { source: "github", id: "I1", ref: "backend#3698", title: "Verify a saved LLM key", score: 2.8, reason: "customer" },
    { source: "local", id: "2026-09-23:5", ref: "2026-09-23", title: "Review sync PRs", score: 1.4, reason: "unblocks" },
  ],
};

const linearMissing: LinearSnapshot = { kind: "unavailable", reason: "set LINEAR_API_KEY on the hub to see Linear issues" };

async function mockTasks(page: Page, saved: Partial<TaskOrders> = {}) {
  const writes: { path: string; body: unknown }[] = [];
  let socket: WebSocketRoute | null = null;
  let localNow = local;
  let githubNow = github;
  const orders: TaskOrders = { local: [], linear: [], github: [], ...saved };
  const ordered: TaskOrder[] = [];
  await page.route("**/api/fleet", r => r.fulfill({ json: fleet }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route("**/api/tasks/local", r => r.fulfill({ json: localNow }));
  await page.route("**/api/tasks/linear", r => r.fulfill({ json: linearMissing }));
  await page.route("**/api/tasks/github", r => r.fulfill({ json: githubNow }));
  await page.route("**/api/tasks/priority", r => r.fulfill({ json: priority }));
  await page.route("**/api/tasks/order", r => {
    const o = TaskOrderSchema.safeParse(r.request().postDataJSON());
    if (o.success) {
      ordered.push(o.data);
      orders[o.data.source] = o.data.keys;
    }
    return r.fulfill({ json: o.success ? { ok: true } : orders });
  });
  await page.route(/\/api\/tasks\/\w+\/(move|block|today)$/, r => {
    const path = new URL(r.request().url()).pathname;
    const body: unknown = r.request().postDataJSON();
    writes.push({ path, body });
    const lm = LocalMoveSchema.safeParse(body);
    if (path === "/api/tasks/local/move" && lm.success && localNow.kind === "ready") {
      localNow = { ...localNow, tasks: localNow.tasks.map(t => (t.line === lm.data.line && t.date === lm.data.date ? { ...t, state: lm.data.to } : t)) };
    }
    const gm = GithubMoveSchema.safeParse(body);
    if (path === "/api/tasks/github/move" && gm.success && githubNow.kind === "ready") {
      githubNow = { ...githubNow, issues: githubNow.issues.map(i => (i.id === gm.data.id ? { ...i, column: gm.data.to } : i)) };
    }
    return r.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket("**/ws", ws => {
    socket = ws;
    ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage));
  });
  return { writes, ordered, push: (msg: ServerMessage) => socket?.send(JSON.stringify(msg)) };
}

async function drag(page: Page, card: string, column: string) {
  const handle = page.locator("[data-card]", { hasText: card });
  await expect(handle).toBeVisible();
  const from = await handle.boundingBox();
  const to = await page.locator(`[data-column="${column}"]`).boundingBox();
  if (!from || !to) throw new Error("card or column not on screen");
  await page.mouse.move(from.x + 30, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 30, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 200, { steps: 8 });
  await page.mouse.up();
}

async function dragOnto(page: Page, card: string, onto: string, half: "top" | "bottom") {
  const from = await page.locator("[data-card]", { hasText: card }).boundingBox();
  const to = await page.locator("[data-card]", { hasText: onto }).boundingBox();
  if (!from || !to) throw new Error("cards not on screen");
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x + 30, to.y + (half === "top" ? 4 : to.height - 4), { steps: 10 });
  await page.mouse.up();
}

const cardTitles = (page: Page, id: string) => column(page, id).locator("[data-card]");

const column = (page: Page, id: string) => page.locator(`[data-column="${id}"]`);

test("the local board shows this week's tasks by state, with links as separate pieces", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/tasks");
  await expect(column(page, "open").getByText("Fix the issue")).toBeVisible();
  await expect(column(page, "doing").getByText("Review sync PRs")).toBeVisible();
  await expect(column(page, "done").getByText("Understand hasura timeout")).toBeVisible();
  const prs = column(page, "done").getByRole("link");
  await expect(prs).toHaveText(["#3862", "#3866"]);
  await expect(prs.first()).toHaveAttribute("href", "https://github.com/databrainhq/backend/pull/3862");
  await expect(column(page, "open").getByRole("link", { name: "DEV-508" })).toBeVisible();
  await expect(page.getByRole("button", { name: "create, carry 3 open" })).toBeVisible();
});

test("dragging a card to doing rewrites that line's checkbox, guarded by the line as it was", async ({ page }) => {
  const hub = await mockTasks(page);
  await page.goto("/tasks");
  await drag(page, "Review Cursor bot PRs", "doing");
  await expect(column(page, "doing").getByText("Review Cursor bot PRs")).toBeVisible();
  await expect.poll(() => hub.writes).toEqual([{ path: "/api/tasks/local/move", body: { date: "2026-09-23", line: 4, raw: "- [ ] Review Cursor bot PRs", to: "doing" } }]);
});

test("dragging a card above another in its column reorders it, and the order survives a reload", async ({ page }) => {
  const hub = await mockTasks(page);
  await page.goto("/tasks");
  await expect(cardTitles(page, "open").first()).toContainText("Fix the issue");
  await dragOnto(page, "Review Cursor bot PRs", "Fix the issue", "top");
  await expect(cardTitles(page, "open").first()).toContainText("Review Cursor bot PRs");
  await expect.poll(() => hub.ordered.at(-1)?.keys.slice(0, 2)).toEqual(["Review Cursor bot PRs", "Fix the issue"]);
  expect(hub.writes).toEqual([]);

  await page.reload();
  await expect(cardTitles(page, "open").first()).toContainText("Review Cursor bot PRs");
});

test("a card dropped below one in another column lands there, moving state and position together", async ({ page }) => {
  const hub = await mockTasks(page, { local: ["Review sync PRs"] });
  await page.goto("/tasks");
  await dragOnto(page, "Fix the issue", "Review sync PRs", "bottom");
  await expect(cardTitles(page, "doing")).toHaveText([/Review sync PRs/, /Fix the issue/]);
  await expect.poll(() => hub.writes.map(w => w.path)).toEqual(["/api/tasks/local/move"]);
  expect(hub.ordered.at(-1)?.keys.indexOf("Fix the issue")).toBe((hub.ordered.at(-1)?.keys.indexOf("Review sync PRs") ?? -9) + 1);
});

test("a note changed in Obsidian shows up without a reload", async ({ page }) => {
  const hub = await mockTasks(page);
  await page.goto("/tasks");
  await expect(column(page, "open").getByText("Review Cursor bot PRs")).toBeVisible();
  hub.push({ type: "tasks-local", snapshot: { ...local, tasks: local.tasks.map(t => (t.line === 4 ? { ...t, state: "done" } : t)) } });
  await expect(column(page, "done").getByText("Review Cursor bot PRs")).toBeVisible();
});

test("a card opens its markdown, and editing it saves the block back to the note", async ({ page }) => {
  const hub = await mockTasks(page);
  await page.goto("/tasks");
  await page.locator("[data-card]", { hasText: "Fix the issue" }).click();
  const drawer = page.getByRole("complementary", { name: "Fix the issue" });
  await expect(drawer.getByText("2026-09-23.md line 1")).toBeVisible();
  await expect(drawer.getByRole("link", { name: "DEV-508" }).last()).toBeVisible();
  const editor = drawer.getByRole("textbox", { name: "task markdown" });
  await editor.fill("- [ ] Fix the issue\n\t- [x] all done");
  await drawer.getByRole("heading", { name: "Fix the issue" }).click();
  await expect.poll(() => hub.writes).toEqual([
    {
      path: "/api/tasks/local/block",
      body: { date: "2026-09-23", line: 0, block: "- [ ] Fix the issue - https://linear.app/databrain/issue/DEV-508/x\n\t- [x] editor owns the formatter", next: "- [ ] Fix the issue\n\t- [x] all done" },
    },
  ]);
});

test("picking a day in the sidebar narrows the board to that note", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "mon 21" }).first().click();
  await expect(page.locator("[data-card]")).toHaveCount(1);
  await expect(page.getByText("Understand hasura timeout")).toBeVisible();
});

test("the source switch moves between boards, and Linear explains what it needs", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/tasks");
  await page.getByRole("radio", { name: "linear" }).click();
  await expect(page).toHaveURL(/\/tasks\/linear$/);
  await expect(page.getByText("set LINEAR_API_KEY on the hub to see Linear issues")).toBeVisible();
  await page.getByRole("radio", { name: "github" }).click();
  await expect(page).toHaveURL(/\/tasks\/github$/);
  await expect(column(page, "progress").getByText("Redis cache hint")).toBeVisible();
});

test("github: dropping on closed closes the issue, while in progress refuses drops", async ({ page }) => {
  const hub = await mockTasks(page);
  await page.goto("/tasks/github");
  await drag(page, "Verify a saved LLM key", "progress");
  await expect(column(page, "open").getByText("Verify a saved LLM key")).toBeVisible();
  expect(hub.writes).toEqual([]);
  await drag(page, "Verify a saved LLM key", "closed");
  await expect(column(page, "closed").getByText("Verify a saved LLM key")).toBeVisible();
  await expect.poll(() => hub.writes).toEqual([{ path: "/api/tasks/github/move", body: { id: "I1", to: "closed" } }]);
});

test("the all board folds every source onto open, doing and done, ranges by last activity, and still works with linear down", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/tasks");
  await page.getByRole("radiogroup", { name: "task source" }).getByRole("radio", { name: "all" }).click();
  await expect(page).toHaveURL(/\/tasks\/all$/);
  await expect(column(page, "open").getByText("Fix the issue")).toBeVisible();
  await expect(page.locator("[data-card]", { hasText: "Verify a saved LLM key" })).toHaveCount(0);
  await page.getByRole("radiogroup", { name: "range" }).getByRole("radio", { name: "all" }).click();
  await expect(column(page, "open").getByText("Verify a saved LLM key")).toBeVisible();
  await expect(column(page, "doing").getByText("Review sync PRs")).toBeVisible();
  await expect(column(page, "doing").getByText("Redis cache hint")).toBeVisible();
  await expect(column(page, "done").getByText("Understand hasura timeout")).toBeVisible();
  await expect(page.locator('[data-sync="linear"]')).toHaveText("down");
  await expect(page.locator("[data-card]", { hasText: "Verify a saved LLM key" }).getByLabel("github")).toBeVisible();
});

test("all: a drop becomes the card's own source move, and github refuses doing", async ({ page }) => {
  const hub = await mockTasks(page);
  await page.goto("/tasks/all");
  await page.getByRole("radiogroup", { name: "range" }).getByRole("radio", { name: "all" }).click();
  await drag(page, "Verify a saved LLM key", "doing");
  await expect(column(page, "open").getByText("Verify a saved LLM key")).toBeVisible();
  expect(hub.writes).toEqual([]);
  await drag(page, "Verify a saved LLM key", "done");
  await expect(column(page, "done").getByText("Verify a saved LLM key")).toBeVisible();
  await drag(page, "Review Cursor bot PRs", "doing");
  await expect(column(page, "doing").getByText("Review Cursor bot PRs")).toBeVisible();
  await expect
    .poll(() => hub.writes)
    .toEqual([
      { path: "/api/tasks/github/move", body: { id: "I1", to: "closed" } },
      { path: "/api/tasks/local/move", body: { date: "2026-09-23", line: 4, raw: "- [ ] Review Cursor bot PRs", to: "doing" } },
    ]);
});

test("all: a card opens its own source's drawer", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/tasks/all");
  await page.getByRole("radiogroup", { name: "range" }).getByRole("radio", { name: "all" }).click();
  await page.locator("[data-card]", { hasText: "Verify a saved LLM key" }).click();
  await expect(page.getByRole("complementary", { name: "backend #3698" })).toBeVisible();
  await page.locator("[data-card]", { hasText: "Review Cursor bot PRs" }).click();
  await expect(page.getByRole("complementary", { name: "Review Cursor bot PRs" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "backend #3698" })).toHaveCount(0);
});

test("github: an issue's body renders as markdown with its references linked", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/tasks/github");
  await page.locator("[data-card]", { hasText: "Verify a saved LLM key" }).click();
  const drawer = page.getByRole("complementary", { name: "backend #3698" });
  await expect(drawer.getByRole("heading", { name: "Origin" })).toBeVisible();
  await expect(drawer.getByText("from linear")).toBeVisible();
});

test("priority sits on every board, and a pick from another source opens its drawer without leaving the board", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/tasks");
  const section = page.getByRole("region", { name: "priority" });
  await expect(section.getByText("14 ranked", { exact: false })).toBeVisible();
  const rows = section.getByRole("button", { name: /Verify|Review/ });
  await expect(rows).toHaveText([/Verify a saved LLM key.*customer.*backend#3698/, /Review sync PRs.*unblocks.*wed 23/]);
  await expect(section.getByRole("img", { name: "return on investment 2.8 of 3" })).toBeVisible();

  await rows.first().click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("complementary", { name: "backend #3698" })).toBeVisible();
  await expect(rows.first()).toHaveAttribute("aria-pressed", "true");

  /* A card picked on the board itself replaces the peek. */
  await column(page, "open").getByText("Review Cursor bot PRs").click();
  await expect(page.getByRole("complementary", { name: "Review Cursor bot PRs" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "backend #3698" })).toHaveCount(0);

  await page.goto("/tasks/github");
  await expect(page.getByRole("region", { name: "priority" }).getByText("Verify a saved LLM key")).toBeVisible();
});

test("priority ranks only when asked: nothing until ↻, then the ranking", async ({ page }) => {
  await mockTasks(page);
  let ranked = false;
  await page.route("**/api/tasks/priority", r => r.fulfill({ json: ranked ? priority : ({ kind: "unranked" } satisfies PrioritySnapshot) }));
  await page.route("**/api/tasks/priority/refresh", r => {
    ranked = true;
    return r.fulfill({ json: priority });
  });
  await page.goto("/tasks");
  const section = page.getByRole("region", { name: "priority" });
  await expect(section.getByText("press ↻ to rank")).toBeVisible();
  await section.getByRole("button", { name: "rank again" }).click();
  await expect(section.getByText("Verify a saved LLM key")).toBeVisible();
});

test("the tasks module is reachable from the top bar", async ({ page }) => {
  await mockTasks(page);
  await page.goto("/machines");
  await page.getByRole("link", { name: "tasks" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("link", { name: "tasks" })).toHaveAttribute("aria-current", "page");
});

test("coming back to a board after a while shows it at once instead of asking GitHub again", async ({ page }) => {
  await page.clock.install();
  await mockTasks(page);
  await page.goto("/tasks/github");
  await expect(column(page, "open").getByText("Verify a saved LLM key")).toBeVisible();
  await page.route("**/api/tasks/github", async r => {
    await new Promise(done => setTimeout(done, 3000));
    await r.fulfill({ json: github });
  });
  const nav = page.getByRole("navigation", { name: "modules" });
  await nav.getByRole("link", { name: "machines" }).click();
  await page.clock.fastForward("10:00");
  await nav.getByRole("link", { name: "tasks" }).click();
  await page.getByRole("radio", { name: "github" }).click();
  await expect(column(page, "open").getByText("Verify a saved LLM key")).toBeVisible({ timeout: 1000 });
  await expect(page.getByText("asking GitHub")).toHaveCount(0);
});

test("a task linking vault notes shows plain titles, and its drawer shows each note or offers to create it", async ({ page }) => {
  const hub = await mockTasks(page);
  const linked = task({ line: 7, title: "[[Verify merged Copilot AI fixes]]", state: "open", block: "- [ ] [[Verify merged Copilot AI fixes]]\n\t- then [[copilot follow-ups]]" });
  await page.route("**/api/tasks/local", r => r.fulfill({ json: { ...local, tasks: [...(local.kind === "ready" ? local.tasks : []), linked] } }));
  const note = { id: "databrain/Verify merged Copilot AI fixes", text: "---\ntags: [copilot]\n---\nCheck the **SQL run** fix on dev.", mtime: Date.now() };
  await page.route("**/api/notes", r => r.fulfill({ json: { kind: "ready", notes: buildIndex([note]), changedAt: Date.now() } }));
  await page.route("**/api/notes/file?**", r => r.fulfill({ json: note }));
  await page.route("**/api/notes/new", r => {
    hub.writes.push({ path: "/api/notes/new", body: r.request().postDataJSON() });
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/tasks");

  const card = page.locator("[data-card]", { hasText: "Verify merged Copilot AI fixes" });
  await expect(card).not.toContainText("[[");
  await card.click();
  const drawer = page.getByRole("complementary", { name: "Verify merged Copilot AI fixes" });
  await expect(drawer.getByRole("heading", { name: "Verify merged Copilot AI fixes" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Verify merged Copilot AI fixes" })).toHaveAttribute("href", "/notes/databrain%2FVerify%20merged%20Copilot%20AI%20fixes");
  await expect(drawer.getByText("SQL run")).toBeVisible();
  await expect(drawer).not.toContainText("tags:");

  await expect(drawer.getByText("not in vault")).toBeVisible();
  await drawer.getByRole("button", { name: "create copilot follow-ups.md" }).click();
  await expect.poll(() => hub.writes).toEqual([{ path: "/api/notes/new", body: { id: "copilot follow-ups" } }]);
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwBfNaEYzmiH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBHsYBafyS08sAAAAASUVORK5CYII=", "base64");

test("an image pasted into a task shows on its card and opens in a preview, not as raw embed text", async ({ page }) => {
  await mockTasks(page);
  const pasted = task({ line: 7, title: "Look at duckdb TLS issue ![[Pasted image 20260924151137.png]]", state: "doing" });
  await page.route("**/api/tasks/local", r => r.fulfill({ json: { ...local, tasks: [...(local.kind === "ready" ? local.tasks : []), pasted] } }));
  const asked: string[] = [];
  await page.route("**/api/notes/asset?**", r => {
    asked.push(new URL(r.request().url()).searchParams.get("name") ?? "");
    return r.fulfill({ contentType: "image/png", body: PNG });
  });
  await page.goto("/tasks");
  const card = page.locator("[data-card]", { hasText: "Look at duckdb TLS issue" });
  await expect(card).not.toContainText("![[");
  const thumb = card.getByRole("img", { name: "Pasted image 20260924151137.png" });
  await expect(thumb).toBeVisible();
  await expect.poll(() => asked).toContain("Pasted image 20260924151137.png");

  await thumb.click();
  const preview = page.getByRole("dialog", { name: "Pasted image 20260924151137.png" });
  await expect(preview.getByRole("img")).toBeVisible();
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
});

test("the image preview zooms with buttons and the wheel, pans by dragging, and only a clean click outside closes it", async ({ page }) => {
  await mockTasks(page);
  const pasted = task({ line: 7, title: "Look at duckdb TLS issue ![[Pasted image 20260924151137.png]]", state: "doing" });
  await page.route("**/api/tasks/local", r => r.fulfill({ json: { ...local, tasks: [...(local.kind === "ready" ? local.tasks : []), pasted] } }));
  await page.route("**/api/notes/asset?**", r => r.fulfill({ contentType: "image/png", body: PNG }));
  await page.goto("/tasks");
  await page.locator("[data-card]", { hasText: "Look at duckdb TLS issue" }).getByRole("img").click();
  const preview = page.getByRole("dialog", { name: "Pasted image 20260924151137.png" });
  const image = preview.getByRole("img");
  await expect(image).toBeVisible();
  await expect(preview).toContainText("100%");
  await expect(preview.getByRole("button", { name: "zoom out" })).toBeDisabled();

  const fitted = await image.boundingBox();
  await preview.getByRole("button", { name: "zoom in" }).click();
  await expect(preview).toContainText("150%");
  await expect.poll(async () => (await image.boundingBox())?.width).toBeGreaterThan((fitted?.width ?? 0) * 1.4);

  const box = await image.boundingBox();
  if (!box) throw new Error("image not on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const zoom = async () => Number((await preview.textContent())?.match(/(\d+)%/)?.[1]);
  await page.mouse.wheel(0, -100);
  await expect.poll(zoom).toBeGreaterThan(150);
  await page.waitForTimeout(400);
  expect(await zoom()).toBeLessThanOrEqual(220);

  const before = await image.boundingBox();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await image.boundingBox())?.x).not.toBe(before?.x);
  await expect(preview).toBeVisible();

  await preview.getByRole("button", { name: "reset zoom" }).click();
  await expect(preview).toContainText("100%");
  await page.mouse.click(8, 8);
  await expect(preview).toHaveCount(0);
});
