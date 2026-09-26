import { expect, test, type Page, type Route } from "@playwright/test";
import type { ServerMessage } from "../src/shared/schema";
import { RequestReviewSchema, shipBadge, type ReadinessSnapshot, type ShipBody, type ShipPr, type ShipSearch, type ShipSnapshot } from "../src/shared/ship";
import type { GithubRef, LinearRef } from "../src/shared/refs";
import type { Px0Session, Px0Sessions } from "../src/shared/px0";
import { events, fleet, shipPr as pr, withShipOrg } from "./fixtures";

const MINE: ShipPr[] = [
  pr({ id: "M1", number: 8231, title: "fix(rls): scope semantic cache by tenant id", state: "blocked", why: "ci: e2e-rls failing", body: "<!-- before-and-after:start -->\nKeys now include **tenant id**, after #3390.\n<!-- before-and-after:end -->\n\nTicket: https://linear.app/databrain/issue/DAT-881/x", checks: [{ name: "lint", conclusion: "passed", url: null }, { name: "e2e-rls", conclusion: "failed", url: "https://github.com/databrainhq/backend/actions/runs/1" }], reviews: [{ login: "nisha-r", state: "approved" }], changedFiles: 9, files: [{ path: "packages/@databrainhq/backend/src/cache/semantic.ts", additions: 48, deletions: 22 }] }),
  pr({ id: "M2", number: 3712, repo: "databrainhq/frontend-mono", url: "https://github.com/databrainhq/frontend-mono/pull/3712", title: "feat(ai): agent tool router", state: "ready", why: "approved, green", reviews: [{ login: "vk-db", state: "approved" }, { login: "sanjay-m", state: "approved" }] }),
  pr({ id: "M3", number: 8219, title: "feat: stream agent traces to clickhouse", state: "waiting", why: "waiting on sanjay-m", pending: ["sanjay-m"] }),
  pr({ id: "M4", number: 3690, repo: "databrainhq/frontend-mono", title: "wip: ai chat sidebar v2", state: "draft", why: "draft", draft: true }),
];

const REVIEW: ShipPr[] = [
  pr({ id: "R1", number: 8228, title: "perf: batch hasura permission checks", author: "sanjay-m", relation: "requested", pending: ["me"], why: "waiting on you" }),
  pr({ id: "R2", number: 8202, title: "feat(agent): tool call audit log", author: "vk-db", relation: "rereview", newCommits: 4, reviews: [{ login: "me", state: "approved" }] }),
];

const FOUND: ShipPr[] = [
  pr({ id: "S1", number: 8244, title: "feat: rotate embed token signing keys", author: "sanjay-m", relation: "none", pending: ["vk-db"], why: "waiting on vk-db", body: "Each tenant gets its own key." }),
  pr({ id: "S2", number: 3698, repo: "databrainhq/frontend-mono", title: "fix: rls badge on shared dashboards", author: "nisha-r", relation: "none" }),
];

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwBfNaEYzmiH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBHsYBafyS08sAAAAASUVORK5CYII=", "base64");
const SIGNED = "https://private-user-images.githubusercontent.com/294425880";

const RENDERED = `
<h2>What this does</h2>
<p>Merges <code>drill_to</code> into one tool. Stacked on <a class="issue-link" href="/databrainhq/backend/pull/1">#1</a>.</p>
<markdown-accessiblity-table><table role="table"><thead><tr><th>Before</th><th>After</th></tr></thead><tbody><tr>
<td><a target="_blank" rel="noopener noreferrer" href="${SIGNED}/before.png?jwt=a"><img src="${SIGNED}/before.png?jwt=a" alt="Before" style="max-width: 100%;"></a></td>
<td><a target="_blank" rel="noopener noreferrer" href="${SIGNED}/after.png?jwt=b"><img src="${SIGNED}/after.png?jwt=b" alt="After" style="max-width: 100%;"></a></td>
</tr></tbody></table></markdown-accessiblity-table>
<details open="" class="details-reset border rounded-2"><summary class="px-3 py-2"><svg class="octicon"><path d="M0 0"></path></svg><span>drill-demo.mp4</span></summary>
<video src="${SIGNED}/drill-demo.mp4?jwt=c" controls="controls" muted="muted" class="d-block" style="max-height:640px; min-height: 200px"></video></details>
<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked=""> e2e passes</li></ul>
<img src="${SIGNED}/missing.png" onerror="window.__pwned = true">
<script>window.__pwned = true</script>`;

const RANKED: ReadinessSnapshot = {
  kind: "ready",
  rankedAt: Date.now(),
  costUsd: 0.001,
  more: 0,
  unranked: 1,
  items: [
    { id: "M2", repo: "databrainhq/frontend-mono", number: 3712, title: "feat(ai): agent tool router", score: 2.9, move: "merge", evidence: ["approved, green"] },
    { id: "M1", repo: "databrainhq/backend", number: 8231, title: "fix(rls): scope semantic cache by tenant id", score: 1.2, move: "fix ci", evidence: ["ci: e2e-rls failing", "+10 −2 · 9 files", "DAT-881 · In Review"] },
  ],
};

type HubOptions = { snapshot?: ShipSnapshot; requestFails?: string; body?: ShipBody; readiness?: ReadinessSnapshot };

async function mockShip(page: Page, opts: HubOptions = {}) {
  let review = REVIEW;
  let found = FOUND;
  const searches: string[] = [];
  const requests: unknown[] = [];
  const snapshot = (): ShipSnapshot => opts.snapshot ?? { kind: "ready", org: "databrainhq", me: "me", mine: MINE, review, fetchedAt: Date.now() };

  await withShipOrg(page);
  await page.route("**/api/fleet", r => r.fulfill({ json: fleet }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route("**/api/ship", r => r.fulfill({ json: snapshot() }));
  await page.route("**/api/ship/badge", r => r.fulfill({ json: shipBadge(snapshot()) }));
  let readiness: ReadinessSnapshot = opts.readiness ?? RANKED;
  let rankings = 0;
  await page.route("**/api/ship/readiness", r => r.fulfill({ json: readiness }));
  await page.route("**/api/ship/readiness/refresh", r => {
    rankings++;
    readiness = RANKED;
    return r.fulfill({ json: readiness });
  });
  await page.route("**/api/ship/search?**", (r: Route) => {
    const q = new URL(r.request().url()).searchParams.get("q") ?? "";
    searches.push(q);
    const prs = found.filter(p => p.title.toLowerCase().includes(q.toLowerCase()));
    return r.fulfill({ json: { kind: "ready", query: `is:pr org:databrainhq ${q}`, total: q ? prs.length : 235, prs } satisfies ShipSearch });
  });
  const bodies: string[] = [];
  await page.route("**/api/ship/body?**", r => {
    bodies.push(new URL(r.request().url()).searchParams.get("id") ?? "");
    return r.fulfill({ json: opts.body ?? ({ kind: "ready", html: RENDERED } satisfies ShipBody) });
  });
  await page.route(`${SIGNED}/**`, r => (r.request().url().includes(".png?") ? r.fulfill({ contentType: "image/png", body: PNG }) : r.fulfill({ status: r.request().url().endsWith(".png") ? 404 : 200, body: "" })));
  await page.route("**/api/ship/request", r => {
    const body = RequestReviewSchema.parse(r.request().postDataJSON());
    requests.push(body);
    if (opts.requestFails) return r.fulfill({ status: 502, json: { error: opts.requestFails } });
    const hit = found.find(p => p.id === body.id);
    if (hit) {
      const asked = { ...hit, relation: "requested" as const, pending: [...hit.pending, "me"] };
      found = found.map(p => (p.id === body.id ? asked : p));
      review = [...review, asked];
    }
    return r.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket("**/ws", ws => ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage)));
  return { searches, requests, bodies, rankings: () => rankings };
}

const table = (page: Page) => page.getByRole("table", { name: "pull requests" });
const row = (page: Page, text: string | RegExp) => table(page).getByRole("row").filter({ hasText: text });
const group = (page: Page, name: string) => table(page).getByRole("rowgroup", { name });
const preview = (page: Page, name: string) => page.getByRole("complementary", { name });

test.describe("desktop", () => {
  test("merge readiness ranks my PRs closest to merged first, and a pick reveals the PR with the facts behind it", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    const sidebar = page.getByRole("complementary", { name: "ship sidebar" });
    const section = sidebar.getByRole("region", { name: "merge readiness" });
    await expect(section).toContainText("2 ranked");
    await expect(section).toContainText("+ 1 unranked");
    const rows = section.getByRole("button", { pressed: false }).filter({ hasText: /#\d+/ });
    await expect(rows).toHaveText([/agent tool router.*merge.*frontend-mono#3712/, /scope semantic cache.*fix ci.*backend#8231/]);
    await expect(section.getByRole("img", { name: "merge readiness 2.9 of 3" })).toBeVisible();

    await sidebar.getByRole("region", { name: "repos" }).getByRole("button", { name: /backend/ }).click();
    await expect(row(page, "#8231")).toHaveCount(0);
    await sidebar.getByRole("link", { name: /waiting on you/ }).click();
    await expect(page).toHaveURL(/\/ship\/review$/);
    await section.getByRole("button", { name: /scope semantic cache/ }).click();

    await expect(page).toHaveURL(/\/ship$/);
    await expect(row(page, "#8231")).toHaveAttribute("aria-selected", "true");
    await expect(preview(page, "backend #8231")).toBeVisible();
    const picked = section.getByRole("button", { name: /scope semantic cache/ });
    await expect(picked).toHaveAttribute("aria-pressed", "true");
    await expect(picked.getByLabel("why")).toHaveText(/ci: e2e-rls failing.*9 files.*DAT-881 · In Review/);
  });

  test("merge readiness waits for ↻ before asking Jev", async ({ page }) => {
    const hub = await mockShip(page, { readiness: { kind: "unranked" } });
    await page.goto("/ship");
    const section = page.getByRole("region", { name: "merge readiness" });
    await expect(section).toContainText("press ↻ to rank your pull requests");
    expect(hub.rankings()).toBe(0);
    await section.getByRole("button", { name: "rank merge readiness again" }).click();
    await expect(section).toContainText("2 ranked");
    expect(hub.rankings()).toBe(1);
  });

  test("the prs tab is now ship: it links to /ship and counts what waits on me", async ({ page }) => {
    await mockShip(page);
    await page.goto("/machines");
    const nav = page.getByRole("navigation", { name: "modules" });
    await expect(nav.getByText("prs", { exact: true })).toHaveCount(0);
    const ship = nav.getByRole("link", { name: /ship/ });
    await expect(ship.getByLabel("2 waiting on you")).toHaveText("2");
    await ship.click();
    await expect(page).toHaveURL(/\/ship$/);
    await expect(ship).toHaveAttribute("aria-current", "page");
  });

  test("mine groups my PRs by ship state, shippable first, and each row says why", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    await expect(table(page).locator("tbody[aria-label]")).toHaveCount(4);
    expect(await table(page).locator("tbody[aria-label]").evaluateAll(els => els.map(e => e.getAttribute("aria-label")))).toEqual(["ready to ship", "blocked", "waiting on review", "draft"]);

    const blocked = row(page, "#8231");
    await expect(blocked).toContainText("ci: e2e-rls failing");
    await expect(blocked).toContainText("1/2");
    await expect(blocked).toContainText("1 ✓");
    await expect(row(page, "#3712")).toContainText("2 ✓");
    await expect(row(page, "#8219")).toContainText("0/1");
    await expect(row(page, "#8219")).toContainText("3h");

    const sidebar = page.getByRole("complementary", { name: "ship sidebar" });
    await expect(sidebar.getByRole("link", { name: /mine/ })).toContainText("4");
    await expect(sidebar.getByRole("link", { name: /waiting on you/ })).toContainText("2");
    await expect(sidebar.getByText("1 re-review")).toBeVisible();
  });

  test("ship state and repo filters narrow the mine list and toggle back", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    const sidebar = page.getByRole("complementary", { name: "ship sidebar" });
    await sidebar.getByRole("button", { name: /blocked/ }).click();
    await expect(table(page).locator("tbody[aria-label]")).toHaveCount(1);
    await expect(row(page, "#8231")).toBeVisible();
    await sidebar.getByRole("button", { name: /blocked/ }).click();
    await expect(table(page).locator("tbody[aria-label]")).toHaveCount(4);

    await sidebar.getByRole("region", { name: "repos" }).getByRole("button", { name: /frontend-mono/ }).click();
    await expect(row(page, "#3712")).toHaveCount(0);
    await expect(row(page, "#8231")).toBeVisible();
    await sidebar.getByRole("region", { name: "repos" }).getByRole("button", { name: /frontend-mono/ }).click();
    await expect(row(page, "#3712")).toBeVisible();
  });

  test("the filter box narrows by any word in the row, says when nothing matches, and escape clears it", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    const box = page.getByRole("searchbox", { name: "filter mine" });
    await box.fill("clickhouse");
    await expect(table(page).getByRole("row").filter({ hasText: "#" })).toHaveCount(1);
    await expect(row(page, "#8219")).toBeVisible();
    await box.fill("frontend-mono sidebar");
    await expect(row(page, "#3690")).toBeVisible();
    await box.fill("nothing like this");
    await expect(page.getByText("no pull request matches")).toBeVisible();
    await box.press("Escape");
    await expect(box).toHaveValue("");
    await expect(row(page, "#8231")).toBeVisible();
  });

  test("the preview shows the ship check, failing checks, reviews, files, ticket and description", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    await row(page, "#8231").click();
    await expect(row(page, "#8231")).toHaveAttribute("aria-selected", "true");
    const p = preview(page, "backend #8231");
    await expect(p.getByRole("heading", { name: "fix(rls): scope semantic cache by tenant id" })).toBeVisible();
    await expect(p.getByText("blocked", { exact: true })).toBeVisible();
    await expect(p.getByRole("link", { name: "e2e-rls", exact: true })).toHaveAttribute("href", "https://github.com/databrainhq/backend/actions/runs/1");
    await expect(p.getByText("ci: e2e-rls failing")).toHaveCount(0);
    await expect(p.getByText("approved by nisha-r")).toBeVisible();
    await expect(p.getByRole("link", { name: "DAT-881" }).first()).toHaveAttribute("href", /linear\.app/);
    await expect(p.getByRole("list", { name: "changed files" })).toContainText("…/cache/semantic.ts");
    await expect(p.getByText("+ 8 more")).toBeVisible();
    await expect(p.getByRole("heading", { name: "What this does" })).toBeVisible();
    await expect(p.getByRole("link", { name: "github", exact: true })).toHaveAttribute("href", "https://github.com/databrainhq/backend/pull/8231");
    const actions = [p.getByRole("button", { name: "copy link" }), p.getByRole("link", { name: "github", exact: true }), p.getByRole("button", { name: "open in px0" }), p.getByRole("button", { name: "review files" })];
    const boxes = await Promise.all(actions.map(a => a.boundingBox()));
    expect(boxes.map(b => b?.height)).toEqual([24, 24, 24, 24]);
    expect(new Set(boxes.map(b => b?.y)).size).toBe(1);
    const drawer = await p.boundingBox();
    expect(boxes.every(b => b && drawer && b.x + b.width <= drawer.x + drawer.width)).toBe(true);
    await expect(p.getByRole("button", { name: /request me/ })).toHaveCount(0);
    await p.getByRole("button", { name: "close details" }).click();
    await expect(p).toBeHidden();
  });

  test("open in px0 starts px0 on the hub in a new tab, and the top bar lists it until it is stopped", async ({ page, context }) => {
    await mockShip(page);
    const running: Px0Session = { id: "backend-8231", repo: "databrainhq/backend", number: 8231, path: "/px0/backend-8231/", ready: true, viewing: true, startedAt: Date.now(), lastUsedAt: Date.now(), rssMb: 22 };
    let sessions: Px0Session[] = [];
    const opens: unknown[] = [];
    const stops: unknown[] = [];
    await page.route("**/api/px0", r => {
      if (r.request().method() !== "POST") return r.fulfill({ json: { idleMs: 1_800_000, sessions } satisfies Px0Sessions });
      opens.push(r.request().postDataJSON());
      sessions = [running];
      return r.fulfill({ json: { path: running.path } });
    });
    await page.route("**/api/px0/stop", r => {
      stops.push(r.request().postDataJSON());
      sessions = [];
      return r.fulfill({ json: { ok: true } });
    });
    await context.route("**/px0/backend-8231/", r => r.fulfill({ contentType: "text/html", body: "<title>px0</title>px0 for backend #8231" }));

    await page.goto("/ship");
    await expect(page.getByRole("button", { name: /^px0 \d/ })).toHaveCount(0);
    await row(page, "#8231").click();
    const opened = context.waitForEvent("page");
    await page.keyboard.press("p");
    const tab = await opened;
    await expect(tab).toHaveURL(/\/px0\/backend-8231\/$/);
    expect(opens).toEqual([{ repo: "databrainhq/backend", number: 8231 }]);
    await expect(preview(page, "backend #8231").getByRole("status")).toContainText("open in a tab · 22 MB");

    await page.getByRole("button", { name: "px0 1" }).click();
    const menu = page.getByRole("region", { name: "px0 running" });
    await expect(menu).toContainText("22 MB total");
    await expect(menu.getByRole("link", { name: /backend #8231/ })).toHaveAttribute("href", "/px0/backend-8231/");
    await menu.getByRole("button", { name: "stop px0 for backend #8231" }).click();
    await expect(page.getByRole("button", { name: "px0 1" })).toHaveCount(0);
    expect(stops).toEqual([{ id: "backend-8231" }]);
  });

  test("opening a PR that already has px0 goes back to its tab instead of starting another", async ({ page, context }) => {
    await mockShip(page);
    const running: Px0Session = { id: "backend-8231", repo: "databrainhq/backend", number: 8231, path: "/px0/backend-8231/", ready: true, viewing: true, startedAt: Date.now(), lastUsedAt: Date.now(), rssMb: 22 };
    let sessions: Px0Session[] = [];
    const opens: unknown[] = [];
    await page.route("**/api/px0", r => {
      if (r.request().method() !== "POST") return r.fulfill({ json: { idleMs: 1_800_000, sessions } satisfies Px0Sessions });
      opens.push(r.request().postDataJSON());
      sessions = [running];
      return r.fulfill({ json: { path: running.path } });
    });
    let loads = 0;
    await context.route("**/px0/backend-8231/", r => {
      loads++;
      return r.fulfill({ contentType: "text/html", body: "<title>px0</title>px0 for backend #8231" });
    });

    await page.goto("/ship");
    await row(page, "#8231").click();
    const opened = context.waitForEvent("page");
    await page.keyboard.press("p");
    const tab = await opened;
    await expect(tab).toHaveURL(/\/px0\/backend-8231\/$/);
    await tab.evaluate(() => sessionStorage.setItem("kept", "yes"));
    await expect(page.getByRole("button", { name: "px0 1" })).toBeVisible();

    await page.bringToFront();
    await page.keyboard.press("p");
    await page.getByRole("button", { name: "px0 1" }).click();
    await page.getByRole("region", { name: "px0 running" }).getByRole("link", { name: /backend #8231/ }).click();
    await page.waitForTimeout(500);
    expect(context.pages()).toHaveLength(2);
    expect(opens).toHaveLength(1);
    expect(loads).toBe(1);
    expect(await tab.evaluate(() => sessionStorage.getItem("kept"))).toBe("yes");

    await tab.close();
    const reopened = context.waitForEvent("page");
    await page.keyboard.press("p");
    await expect(await reopened).toHaveURL(/\/px0\/backend-8231\/$/);
    expect(opens).toHaveLength(1);
  });

  test("a px0 that cannot start closes the waiting tab and says why in the preview", async ({ page, context }) => {
    await mockShip(page);
    await page.route("**/api/px0", r =>
      r.request().method() === "POST" ? r.fulfill({ status: 502, json: { error: "git fetch PR head: repository not found" } }) : r.fulfill({ json: { idleMs: 1_800_000, sessions: [] } satisfies Px0Sessions }),
    );
    await page.goto("/ship");
    await row(page, "#8231").click();
    const opened = context.waitForEvent("page");
    await preview(page, "backend #8231").getByRole("button", { name: "open in px0" }).click();
    const tab = await opened;
    await tab.waitForEvent("close");
    await expect(preview(page, "backend #8231").getByRole("status")).toHaveText("px0git fetch PR head: repository not found");
  });

  test("github and linear links peek in the app, cmd click opens them on their own site", async ({ page, context }) => {
    await mockShip(page);
    await context.route("https://github.com/**", r => r.fulfill({ body: "github" }));
    await page.route("**/api/tasks/linear/issue?**", r =>
      r.fulfill({
        json: {
          kind: "ready",
          issue: { id: "L1", identifier: "DAT-881", title: "Tenant scoped semantic cache", url: "https://linear.app/databrain/issue/DAT-881/x", description: "", priority: "high", column: "progress", stateName: "In Progress", team: { id: "T", key: "DAT", name: "Data" }, assignee: null, creator: null, cycle: null, links: [], updatedAt: "2026-09-25T00:00:00Z" },
        } satisfies LinearRef,
      }),
    );
    await page.route("**/api/tasks/github/ref?**", r => r.fulfill({ json: { kind: "pr", pr: pr({ id: "P1", number: 1, title: "feat: drill tool base" }) } satisfies GithubRef }));
    await page.goto("/ship");
    await row(page, "#8231").click();
    const p = preview(page, "backend #8231");

    const opened = context.waitForEvent("request", r => r.url() === "https://github.com/databrainhq/backend/pull/1");
    await p.getByRole("link", { name: "#1", exact: true }).click({ modifiers: ["ControlOrMeta"] });
    expect((await opened).isNavigationRequest()).toBe(true);
    await expect(page).toHaveURL(/\/ship$/);

    await p.getByRole("link", { name: "#1", exact: true }).click();
    await expect(page).toHaveURL(/\/ship\?peek=databrainhq\/backend\/1$/);
    await expect(preview(page, "backend #1").getByRole("heading", { name: "feat: drill tool base" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /#\d+/ })).toHaveCount(1);

    await preview(page, "backend #1").getByRole("button", { name: "close details" }).click();
    await expect(page).toHaveURL(/\/ship$/);
    await expect(p).toBeVisible();

    await p.getByRole("link", { name: "DAT-881" }).first().click();
    await expect(page).toHaveURL(/\/ship\?peek=DAT-881$/);
    await expect(preview(page, "DAT-881").getByRole("heading", { name: "Tenant scoped semantic cache" })).toBeVisible();
    await expect(p).toBeHidden();
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/ship$/);
    await expect(p).toBeVisible();
  });

  test("keys: j k move through the list, the preview arrows too, esc closes", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    await expect(row(page, "#3712")).toBeVisible();
    await page.keyboard.press("j");
    await expect(row(page, "#3712")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("j");
    await expect(row(page, "#8231")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("k");
    await expect(row(page, "#3712")).toHaveAttribute("aria-selected", "true");
    await preview(page, "frontend-mono #3712").getByRole("button", { name: "next pull request" }).click();
    await expect(preview(page, "backend #8231")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("complementary", { name: /#\d+/ })).toHaveCount(0);
  });

  test("keys: enter opens the PR on GitHub and c copies its link", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockShip(page);
    await context.route("https://github.com/**", r => r.fulfill({ body: "github" }));
    await page.goto("/ship");
    await expect(row(page, "#3712")).toBeVisible();
    await page.keyboard.press("j");
    const popup = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    expect((await popup).url()).toBe("https://github.com/databrainhq/frontend-mono/pull/3712");
    await page.bringToFront();
    await page.keyboard.press("c");
    await expect(page.getByText("link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://github.com/databrainhq/frontend-mono/pull/3712");
  });

  test("keys: 1 2 3 switch queues and / focuses search; typed letters stay in the box", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    await expect(row(page, "#3712")).toBeVisible();
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/\/ship\/review$/);
    await page.keyboard.press("3");
    await expect(page).toHaveURL(/\/ship\/all$/);
    await page.keyboard.press("1");
    await expect(page).toHaveURL(/\/ship$/);
    await page.keyboard.press("/");
    const box = page.getByRole("searchbox", { name: "filter mine" });
    await expect(box).toBeFocused();
    await page.keyboard.type("jk2");
    await expect(box).toHaveValue("jk2");
    await expect(page).toHaveURL(/\/ship$/);
    await expect(table(page).locator("[aria-selected=true]")).toHaveCount(0);
  });

  test("waiting on you puts re-reviews first with how much changed, then requests", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship/review");
    await expect(row(page, "#8202")).toBeVisible();
    expect(await table(page).locator("tbody[aria-label]").evaluateAll(els => els.map(e => e.getAttribute("aria-label")))).toEqual(["re-review", "requested"]);
    await expect(row(page, "#8202")).toContainText("4 new commits");
    await expect(row(page, "#8202")).toContainText("vk-db");
    await row(page, "#8202").click();
    await expect(preview(page, "backend #8202").getByText("4 new commits since your review")).toBeVisible();
    await row(page, "#8228").click();
    await expect(preview(page, "backend #8228").getByText("your review is requested")).toBeVisible();
  });

  test("all searches the org as I type, once per pause, and shows my relation to each PR", async ({ page }) => {
    const hub = await mockShip(page);
    await page.goto("/ship/all");
    await expect(page.getByText("235 matches")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "ship sidebar" }).getByRole("link", { name: /databrainhq/ })).toContainText("235");
    const box = page.getByRole("searchbox", { name: "search databrainhq" });
    await box.pressSequentially("embed", { delay: 30 });
    await expect(row(page, "#8244")).toBeVisible();
    await expect(row(page, "#3698")).toHaveCount(0);
    await expect(page.getByText("1 match", { exact: true })).toBeVisible();
    expect(hub.searches).toEqual(["", "embed"]);
    await expect(row(page, "#8244").getByRole("button", { name: "request me as reviewer on backend #8244" })).toBeVisible();
  });

  test("request me from a row: it flips to requested at once and lands in waiting on you", async ({ page }) => {
    const hub = await mockShip(page);
    await page.goto("/ship/all");
    await row(page, "#8244").getByRole("button", { name: /request me as reviewer/ }).click();
    await expect(row(page, "#8244")).toContainText("requested");
    expect(hub.requests).toEqual([{ id: "S1" }]);
    await expect(row(page, "#8244")).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("navigation", { name: "modules" }).getByLabel("3 waiting on you")).toBeVisible();
    await page.keyboard.press("2");
    await expect(row(page, "#8244")).toBeVisible();
  });

  test("request me from the preview button and with r", async ({ page }) => {
    const hub = await mockShip(page);
    await page.goto("/ship/all");
    await row(page, "#8244").click();
    const p = preview(page, "backend #8244");
    await expect(p.getByText("adds you on github and moves it to waiting on you")).toBeVisible();
    await p.getByRole("button", { name: "request me as reviewer" }).click();
    await expect(p.getByText("your review is requested")).toBeVisible();

    await row(page, "#3698").click();
    await page.keyboard.press("r");
    await expect(preview(page, "frontend-mono #3698").getByText("your review is requested")).toBeVisible();
    expect(hub.requests).toEqual([{ id: "S1" }, { id: "S2" }]);
    await page.keyboard.press("r");
    expect(hub.requests).toHaveLength(2);
  });

  test("when GitHub refuses the request, the reason shows and the row goes back", async ({ page }) => {
    await mockShip(page, { requestFails: "Review cannot be requested from pull request author." });
    await page.goto("/ship/all");
    await row(page, "#8244").getByRole("button", { name: /request me as reviewer/ }).click();
    await expect(page.getByText("Review cannot be requested from pull request author.")).toBeVisible();
    await expect(row(page, "#8244").getByRole("button", { name: /request me as reviewer/ })).toBeVisible();
  });

  test("without an org the view says what to set, and unknown queues fall back to mine", async ({ page }) => {
    await mockShip(page, { snapshot: { kind: "unavailable", reason: "set MIRAI_SHIP_ORG on the hub to the GitHub org whose pull requests to show" } });
    await page.goto("/ship/nope");
    await expect(page.getByText("set MIRAI_SHIP_ORG on the hub")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "ship sidebar" }).getByRole("link", { name: /mine/ })).toHaveAttribute("aria-current", "page");
  });
});

test("the description renders like GitHub: headings, tables of images, videos, task lists, and nothing unsafe", async ({ page }) => {
  const hub = await mockShip(page);
  await page.goto("/ship");
  await row(page, "#8231").click();
  const p = preview(page, "backend #8231");
  await expect(p.getByRole("heading", { name: "What this does" })).toBeVisible();
  expect(hub.bodies).toEqual(["M1"]);

  for (const alt of ["Before", "After"]) {
    const img = p.getByRole("img", { name: alt });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => (el instanceof HTMLImageElement ? el.naturalWidth : 0))).toBeGreaterThan(0);
    await expect(p.locator("a", { has: page.getByRole("img", { name: alt }) })).toHaveAttribute("target", "_blank");
  }

  const pages = page.context().pages().length;
  await p.getByRole("img", { name: "After" }).click();
  const shown = page.getByRole("dialog", { name: "After" });
  await expect(shown.getByRole("img", { name: "After" })).toBeVisible();
  expect(page.context().pages()).toHaveLength(pages);
  await shown.getByRole("button", { name: "close" }).click();
  await expect(shown).toHaveCount(0);

  const video = p.locator("video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("src", `${SIGNED}/drill-demo.mp4?jwt=c`);
  await expect(video).toHaveAttribute("controls", "");
  await expect(p.locator("summary")).toHaveText("drill-demo.mp4");
  await expect(p.locator(".gh-body svg")).toHaveCount(0);

  const box = p.getByRole("checkbox");
  await expect(box).toBeChecked();
  await expect(box).toBeDisabled();

  await expect(p.getByRole("link", { name: "#1" })).toHaveAttribute("href", "https://github.com/databrainhq/backend/pull/1");
  await expect(p.locator(".gh-body script")).toHaveCount(0);
  await expect(p.locator(".gh-body [onerror], .gh-body [style], .gh-body [class]")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
});

test("when GitHub cannot render the description it falls back to the markdown, without html comments", async ({ page }) => {
  await mockShip(page, { body: { kind: "unavailable", reason: "github down" } });
  await page.goto("/ship");
  const withComment = MINE.find(m => m.id === "M1");
  expect(withComment?.body).toContain("tenant id");
  await row(page, "#8231").click();
  const p = preview(page, "backend #8231");
  await expect(p.locator("strong", { hasText: "tenant id" })).toBeVisible();
  await expect(p.getByText("images need GitHub: github down")).toBeVisible();
  await expect(p.getByText("before-and-after")).toHaveCount(0);
  await expect(p.getByRole("link", { name: "#3390" })).toHaveAttribute("href", "https://github.com/databrainhq/backend/issues/3390");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no sideways scroll, queues as tabs, two-line rows and the preview as a bottom sheet", async ({ page }) => {
    await mockShip(page);
    await page.goto("/ship");
    await expect(row(page, "#8231")).toBeVisible();
    const overflow = await page.evaluate(() =>
      [document.scrollingElement, document.querySelector("main"), ...document.querySelectorAll("[data-slot=table-container]")].filter(el => el !== null && el.scrollWidth > el.clientWidth + 1).length,
    );
    expect(overflow).toBe(0);
    const title = await row(page, "#8231").getByText("fix(rls): scope semantic cache").boundingBox();
    expect(title?.width ?? 0).toBeGreaterThan(250);
    await expect(row(page, "#8231")).toContainText("ci: e2e-rls failing");

    await page.getByRole("radio", { name: /waiting on you/ }).tap();
    await expect(page).toHaveURL(/\/ship\/review$/);
    await row(page, "#8228").tap();
    await expect(page.getByRole("dialog", { name: "backend #8228" })).toBeVisible();
  });
});

test("when the hub answers with an old copy, the page asks again within seconds and shows when GitHub was read", async ({ page }) => {
  let calls = 0;
  const old = Date.now() - 10 * 60_000;
  await mockShip(page);
  await page.route("**/api/ship", r => {
    calls++;
    return r.fulfill({ json: { kind: "ready", org: "databrainhq", me: "me", mine: MINE, review: REVIEW, fetchedAt: calls === 1 ? old : Date.now() } satisfies ShipSnapshot });
  });
  await page.goto("/ship");
  await expect(page.getByText("github synced 10m ago")).toBeVisible();
  await expect(page.getByText("github synced just now")).toBeVisible({ timeout: 6000 });
  expect(calls).toBe(2);
  await page.waitForTimeout(4000);
  expect(calls).toBe(2);
});
