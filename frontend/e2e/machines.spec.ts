import { expect, test } from "@playwright/test";
import { miraiThread, miraiTurn, mockHub, mockMirai } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockHub(page);
});

test("the mesh draws every PC from tailscale, with offline machines dimmed", async ({ page }) => {
  await page.goto("/machines");
  const nodes = page.locator("[data-machine]");
  await expect(nodes).toHaveCount(4);
  await expect(page.locator('[data-machine="awsakato"]')).toHaveAttribute("opacity", "0.5");
  await expect(page.getByText("derp sin").first()).toBeVisible();
});

test("clicking a machine on the mesh opens its host view", async ({ page }) => {
  await page.goto("/machines");
  await page.locator('[data-machine="omarikato"]').click();
  await expect(page).toHaveURL(/\/machines\/omarikato$/);
  await expect(page.getByRole("heading", { level: 1, name: "omarikato" })).toBeVisible();
  await expect(page.getByRole("link", { name: /omarikato/ }).and(page.locator("[aria-current=page]"))).toBeVisible();
  await expect(page.getByRole("cell", { name: "hermes-gateway" })).toBeVisible();
  await page.getByRole("tab", { name: "ports" }).click();
  await expect(page.getByRole("cell", { name: ":5437" })).toBeVisible();
});

test("an offline machine explains itself instead of showing empty gauges", async ({ page }) => {
  await page.goto("/machines/awsakato");
  await expect(page.getByText("awsakato is offline. Last seen 3h ago.")).toBeVisible();
});

test("the top bar surfaces failures and heat, and links to the machine", async ({ page }) => {
  await page.goto("/machines");
  await page.getByRole("button", { name: "hermes-gateway failed on omarikato" }).click();
  await expect(page).toHaveURL(/\/machines\/omarikato$/);
});

test("asking from the palette opens mirAI with the current context", async ({ page }) => {
  const asked: unknown[] = [];
  const thread = miraiThread({ turns: [miraiTurn({ question: "why is it hot", view: "omarikato / host", answer: "84°C under load." })] });
  await mockMirai(page, {
    ask: async body => {
      asked.push(body);
      return { status: 200, ndjson: [{ type: "thread", threadId: thread.id }, { type: "done", thread }] };
    },
  });
  await page.goto("/machines/omarikato");
  await page.getByRole("button", { name: /search or ask mirAI/ }).click();
  await page.getByPlaceholder("search or ask mirAI").fill("why is it hot");
  await page.getByText("ask mirAI: why is it hot").click();
  const panel = page.getByRole("complementary", { name: "mirAI" });
  await expect(panel.getByText("why is it hot")).toBeVisible();
  await expect(panel.getByText("sees: omarikato / host")).toBeVisible();
  await expect(panel.getByText("84°C under load.")).toBeVisible();
  expect(asked).toEqual([{ threadId: null, question: "why is it hot", view: "omarikato / host" }]);
});

test("only live machines blink on the mesh", async ({ page }) => {
  await page.goto("/machines");
  await expect(page.locator('[data-live-halo="omarikato"]')).toHaveClass(/animate-live/);
  await expect(page.locator('[data-live-halo="awsakato"]')).toHaveCount(0);
});

test("the process list shows ten rows, then ten more each time the bottom is reached", async ({ page }) => {
  await page.goto("/machines/omarikato");
  const rows = page.getByRole("tabpanel").locator("tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(page.getByText("10 of 25 processes")).toBeVisible();
  const toBottom = async () => {
    await rows.first().hover();
    await page.mouse.wheel(0, 10_000);
  };
  await toBottom();
  await expect(rows).toHaveCount(20);
  await toBottom();
  await expect(rows).toHaveCount(25);
  await expect(page.getByText("25 of 25 processes")).toBeVisible();
  await page.getByRole("tab", { name: "memory" }).click();
  await expect(rows).toHaveCount(10);
});

test("killing a process asks first, then sends the confirmed pid and name to the hub", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/host/omarikato/kill", r => {
    sent.push(r.request().postDataJSON());
    return r.fulfill({ json: { pid: 48213, name: "node", signal: "SIGTERM" } });
  });
  await page.goto("/machines/omarikato");
  await page.getByRole("button", { name: "kill node (48213)" }).click();
  const dialog = page.getByRole("dialog", { name: "kill node?" });
  await expect(dialog.getByText("pid 48213 on omarikato")).toBeVisible();
  expect(sent).toHaveLength(0);
  await dialog.getByRole("button", { name: "terminate" }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([{ pid: 48213, name: "node", signal: "SIGTERM" }]);
});

test("a refused kill keeps the dialog open with the agent's reason", async ({ page }) => {
  await page.route("**/api/host/omarikato/kill", r => r.fulfill({ status: 409, json: { error: "pid 48501 is now node, not postgres" } }));
  await page.goto("/machines/omarikato");
  await page.getByRole("tab", { name: "ports" }).click();
  await page.getByRole("button", { name: "kill postgres (48501)" }).click();
  const dialog = page.getByRole("dialog", { name: "kill postgres?" });
  await dialog.getByRole("button", { name: "force kill" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("pid 48501 is now node, not postgres");
  await dialog.getByRole("button", { name: "cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("a window that grows without scrolling loads one more batch, not every row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/machines/omarikato");
  const rows = page.getByRole("tabpanel").locator("tbody tr");
  await expect(rows).toHaveCount(10);
  await page.setViewportSize({ width: 1440, height: 5000 });
  await expect(rows).toHaveCount(20);
  await page.waitForTimeout(500);
  await expect(rows).toHaveCount(20);
  await page.getByRole("button", { name: "show 5 more" }).click();
  await expect(rows).toHaveCount(25);
  await expect(page.getByRole("button", { name: /show \d+ more/ })).toHaveCount(0);
});
