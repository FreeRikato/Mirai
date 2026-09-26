import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ShipPr, ShipSnapshot } from "../src/shared/ship";
import type { GithubSnapshot } from "../src/shared/tasks";
import { mockHub, withShipOrg } from "./fixtures";

const pr: ShipPr = {
  id: "P1",
  repo: "databrainhq/backend",
  number: 8231,
  title: "fix(rls): scope semantic cache by tenant id",
  url: "https://github.com/databrainhq/backend/pull/8231",
  body: "",
  author: "me",
  draft: false,
  head: "fix/rls",
  base: "develop",
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  files: [],
  checks: [],
  reviews: [],
  pending: [],
  conflicts: false,
  relation: "author",
  newCommits: 0,
  state: "waiting",
  why: "no reviewer yet",
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-23T00:00:00Z",
};

const ship: ShipSnapshot = { kind: "ready", org: "databrainhq", me: "me", mine: [pr], review: [], fetchedAt: Date.now() };

const github: GithubSnapshot = {
  kind: "ready",
  fetchedAt: Date.now(),
  issues: [
    {
      id: "I1",
      repo: "databrainhq/backend",
      number: 3698,
      title: "Verify a saved LLM key",
      url: "https://github.com/databrainhq/backend/issues/3698",
      body: "",
      column: "open",
      labels: [],
      author: "me",
      assignedToMe: true,
      createdByMe: true,
      comments: 0,
      pullRequests: [],
      links: [],
      closedAt: null,
      updatedAt: "2026-09-16T00:00:00Z",
    },
  ],
};

async function mock(page: Page) {
  await mockHub(page);
  await withShipOrg(page);
  await page.route("**/api/ship", r => r.fulfill({ json: ship }));
  await page.route("**/api/tasks/github", r => r.fulfill({ json: github }));
  await page.route("**/api/tasks/priority", r => r.fulfill({ json: { kind: "unavailable", reason: "no priority in tests" } }));
}

const handle = (page: Page, name: string) => page.getByRole("separator", { name: `resize ${name}` });
const width = (page: Page, id: string) => page.locator(`[data-panel="${id}"]`).evaluate(el => Math.round(el.getBoundingClientRect().width));

async function drag(page: Page, h: Locator, dx: number) {
  const box = await h.boundingBox();
  if (!box) throw new Error("handle not on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

type Case = { name: string; id: string; label: string; initial: number; min: number; max: number; grow: 1 | -1; open: (page: Page) => Promise<void> };

const CASES: Case[] = [
  { name: "machine list", id: "machines-rail", label: "machine list", initial: 260, min: 200, max: 420, grow: 1, open: async page => {
    await page.goto("/machines");
    await expect(page.getByRole("heading", { level: 1, name: "fleet" })).toBeVisible();
  } },
  { name: "tasks sidebar", id: "tasks-sidebar", label: "tasks sidebar", initial: 260, min: 200, max: 420, grow: 1, open: async page => {
    await page.goto("/tasks/github");
    await expect(page.getByText("Verify a saved LLM key")).toBeVisible();
  } },
  { name: "ship sidebar", id: "ship-sidebar", label: "ship sidebar", initial: 240, min: 200, max: 400, grow: 1, open: async page => {
    await page.goto("/ship");
    await expect(page.locator("[data-pr]")).toHaveCount(1);
  } },
  { name: "tasks details", id: "tasks-drawer", label: "details", initial: 360, min: 300, max: 648, grow: -1, open: async page => {
    await page.goto("/tasks/github");
    await page.getByText("Verify a saved LLM key").click();
    await expect(page.getByRole("complementary", { name: "backend #3698" })).toBeVisible();
  } },
  { name: "ship preview", id: "ship-preview", label: "preview", initial: 360, min: 300, max: 648, grow: -1, open: async page => {
    await page.goto("/ship");
    await page.locator("[data-pr]").click();
    await expect(page.getByRole("complementary", { name: "backend #8231" })).toBeVisible();
  } },
  { name: "mirAI", id: "mirai", label: "mirAI", initial: 380, min: 320, max: 648, grow: -1, open: async page => {
    await page.goto("/machines");
    await expect(page.getByRole("heading", { level: 1, name: "fleet" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(page.getByRole("complementary", { name: "mirAI" })).toBeVisible();
  } },
];

for (const c of CASES) {
  test(`${c.name}: drags wider and narrower and stops at its limits`, async ({ page }) => {
    await mock(page);
    await c.open(page);
    const h = handle(page, c.label);
    expect(await width(page, c.id)).toBe(c.initial);
    await drag(page, h, 100 * c.grow);
    expect(await width(page, c.id)).toBe(c.initial + 100);
    await drag(page, h, 2000 * c.grow);
    expect(await width(page, c.id)).toBe(c.max);
    await expect(h).toHaveAttribute("aria-valuenow", String(c.max));
    await drag(page, h, -3000 * c.grow);
    expect(await width(page, c.id)).toBe(c.min);
  });
}

test("a width survives a reload, and double-clicking the handle puts the default back", async ({ page }) => {
  await mock(page);
  await page.goto("/ship");
  await expect(page.locator("[data-pr]")).toHaveCount(1);
  await drag(page, handle(page, "ship sidebar"), 80);
  expect(await width(page, "ship-sidebar")).toBe(320);
  await page.reload();
  await expect(page.locator("[data-pr]")).toHaveCount(1);
  expect(await width(page, "ship-sidebar")).toBe(320);
  await handle(page, "ship sidebar").dblclick();
  expect(await width(page, "ship-sidebar")).toBe(240);
  await page.reload();
  await expect(page.locator("[data-pr]")).toHaveCount(1);
  expect(await width(page, "ship-sidebar")).toBe(240);
});

test("the keyboard resizes too: arrows step toward the content, home and end jump to the limits", async ({ page }) => {
  await mock(page);
  await page.goto("/ship");
  await page.locator("[data-pr]").click();
  const left = handle(page, "ship sidebar");
  await left.focus();
  await page.keyboard.press("ArrowRight");
  expect(await width(page, "ship-sidebar")).toBe(256);
  await page.keyboard.press("End");
  expect(await width(page, "ship-sidebar")).toBe(400);
  await page.keyboard.press("Home");
  expect(await width(page, "ship-sidebar")).toBe(200);
  const right = handle(page, "preview");
  await right.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await width(page, "ship-preview")).toBe(376);
  await page.keyboard.press("ArrowRight");
  expect(await width(page, "ship-preview")).toBe(360);
  await expect(page).toHaveURL(/\/ship$/);
});

test("no panel takes more than 45% of a narrow window, and a wide panel shrinks with the window", async ({ page }) => {
  await mock(page);
  await page.goto("/ship");
  await page.locator("[data-pr]").click();
  await drag(page, handle(page, "preview"), -2000);
  expect(await width(page, "ship-preview")).toBe(648);
  await page.setViewportSize({ width: 1000, height: 1000 });
  await expect.poll(() => width(page, "ship-preview")).toBe(450);
  const main = await page.locator("main").evaluate(el => Math.round(el.getBoundingClientRect().width));
  expect(main).toBeGreaterThan(250);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => width(page, "ship-preview")).toBe(648);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("phones have no resize handles", async ({ page }) => {
    await mock(page);
    await page.goto("/ship");
    await expect(page.locator("[data-pr]")).toHaveCount(1);
    await expect(page.getByRole("separator")).toHaveCount(0);
  });
});
