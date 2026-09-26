import { expect, test, type Page } from "@playwright/test";
import type { ShipSnapshot } from "../src/shared/ship";
import { mockHub, withShipOrg } from "./fixtures";

const ship: ShipSnapshot = { kind: "ready", org: "databrainhq", me: "me", mine: [], review: [], fetchedAt: Date.now() };

async function mock(page: Page) {
  await mockHub(page);
  await withShipOrg(page);
  await page.route("**/api/ship", r => r.fulfill({ json: ship }));
  await page.route("**/api/ship/search?**", r => r.fulfill({ json: { kind: "ready", query: "", total: 0, prs: [] } }));
  await page.route("**/api/tasks/local", r => r.fulfill({ json: { kind: "unavailable", reason: "no vault in tests" } }));
  await page.route("**/api/tasks/linear", r => r.fulfill({ json: { kind: "unavailable", reason: "no linear in tests" } }));
  await page.route("**/api/tasks/github", r => r.fulfill({ json: { kind: "unavailable", reason: "no github in tests" } }));
  await page.route("**/api/later", r => r.fulfill({ json: [] }));
  await page.route("**/api/tasks/priority", r => r.fulfill({ json: { kind: "unavailable", reason: "no priority in tests" } }));
}

const palette = (page: Page) => page.getByRole("dialog", { name: "search or ask mirAI" });

async function open(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
}

async function jump(page: Page, text: string) {
  await open(page);
  await palette(page).getByPlaceholder("search or ask mirAI").fill(text);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
}

test("the palette lists every page: fleet and each machine, every tasks board and every ship queue", async ({ page }) => {
  await mock(page);
  await page.goto("/machines");
  await expect(page.getByRole("heading", { level: 1, name: "fleet" })).toBeVisible();
  await open(page);
  const groups = palette(page).locator("[cmdk-group-heading]");
  await expect(groups).toHaveText(["machines", "tasks", "ship", "content", "notes", "stats"]);
  const options = palette(page).getByRole("option");
  for (const name of ["fleet", "macato", "archikato", "awsakato", "omarikato", "daily notes", "linear", "github issues", "my prs", "waiting on you", "all prs", "ai usage"]) {
    await expect(options.filter({ hasText: new RegExp(`^.?${name}`) }).first()).toBeVisible();
  }
  await expect(options.filter({ hasText: "fleet" })).toContainText("here");
});

test("keywords reach the right page from anywhere", async ({ page }) => {
  await mock(page);
  await page.goto("/machines");
  await expect(page.getByRole("heading", { level: 1, name: "fleet" })).toBeVisible();

  await jump(page, "linear");
  await expect(page).toHaveURL(/\/tasks\/linear$/);
  await expect(page.getByText("no linear in tests")).toBeVisible();

  await jump(page, "review");
  await expect(page).toHaveURL(/\/ship\/review$/);

  await jump(page, "my prs");
  await expect(page).toHaveURL(/\/ship$/);

  await jump(page, "obsidian");
  await expect(page).toHaveURL(/\/tasks$/);

  await jump(page, "omarikato");
  await expect(page).toHaveURL(/\/machines\/omarikato$/);

  await jump(page, "databrainhq");
  await expect(page).toHaveURL(/\/ship\/all$/);

  await jump(page, "fleet");
  await expect(page).toHaveURL(/\/machines$/);
});

test("the page you are on is marked, nothing matching says so but still offers mirAI, and the box clears between opens", async ({ page }) => {
  await mock(page);
  await page.goto("/ship/review");
  await expect(page.getByText("nothing is waiting on you")).toBeVisible();
  await open(page);
  await expect(palette(page).getByRole("option", { name: /waiting on you/ })).toContainText("here");
  await expect(palette(page).getByRole("option", { name: /my prs/ })).toContainText("/ship");
  await palette(page).getByPlaceholder("search or ask mirAI").fill("zzzz nothing");
  await expect(palette(page).getByText("no page matches")).toBeVisible();
  await expect(palette(page).getByRole("option", { name: "ask mirAI: zzzz nothing" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  await jump(page, "github issues");
  await open(page);
  await expect(palette(page).getByPlaceholder("search or ask mirAI")).toHaveValue("");
  await expect(palette(page).getByRole("option", { name: /github issues/ })).toContainText("here");
});

test("the org name reaches the PR search even before ship data has loaded", async ({ page }) => {
  await mock(page);
  await page.route("**/api/ship", () => undefined);
  await page.goto("/machines");
  await expect(page.getByRole("heading", { level: 1, name: "fleet" })).toBeVisible();
  await jump(page, "databrainhq");
  await expect(page).toHaveURL(/\/ship\/all$/);
});

test("words must really appear: later reaches the later pages, and watch no longer matches a machine by scattered letters", async ({ page }) => {
  await mock(page);
  await page.goto("/machines");
  await expect(page.getByRole("heading", { level: 1, name: "fleet" })).toBeVisible();
  await open(page);
  await palette(page).getByPlaceholder("search or ask mirAI").fill("watch");
  await expect(palette(page).getByRole("option", { name: /awsakato/ })).toHaveCount(0);
  await expect(palette(page).getByRole("option", { name: /watch content/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await jump(page, "later");
  await expect(page).toHaveURL(/\/content$/);
  await jump(page, "watch");
  await expect(page).toHaveURL(/\/content\/watch$/);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the search icon opens the palette and a tap goes to the page", async ({ page }) => {
    await mock(page);
    await page.goto("/machines");
    await page.getByRole("button", { name: "search or ask mirAI" }).tap();
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole("option", { name: /waiting on you/ }).tap();
    await expect(page).toHaveURL(/\/ship\/review$/);
    await expect(palette(page)).toBeHidden();
  });
});
