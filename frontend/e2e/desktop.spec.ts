import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { Fleet, Machine, Metrics, ServerMessage } from "../src/shared/schema";
import { events, fleet, mockMirai } from "./fixtures";

type SystemTheme = NonNullable<Metrics["system"]>;

const TOKYO_NIGHT: SystemTheme = {
  mode: "dark",
  monoFont: "JetBrainsMono Nerd Font",
  colors: {
    accent: "#7aa2f7",
    selection: "#292e42",
    background: "#1a1b26",
    foreground: "#a9b1d6",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#ad8ee6",
    cyan: "#449dab",
    orange: "#eb927b",
    bright_blue: "#7da6ff",
    bright_magenta: "#bb9af7",
    bright_cyan: "#0db9d7",
    brown: "#75493d",
  },
};

const LATTE: SystemTheme = {
  mode: "light",
  monoFont: "JetBrainsMono Nerd Font",
  colors: { accent: "#1e66f5", selection: "#ccd0da", background: "#eff1f5", foreground: "#4c4f69", blue: "#1e66f5", green: "#40a02b", yellow: "#df8e1d", red: "#d20f39" },
};

const RGB = {
  black: "rgb(0, 0, 0)",
  white: "rgb(255, 255, 255)",
  tokyoBg: "rgb(26, 27, 38)",
  tokyoFg: "rgb(169, 177, 214)",
  tokyoAccent: "rgb(122, 162, 247)",
  latteBg: "rgb(239, 241, 245)",
  darkOk: "rgb(95, 208, 138)",
  lightOk: "rgb(31, 138, 76)",
};

const withThemes = (themes: Readonly<Record<string, SystemTheme>>): Fleet => ({
  ...fleet,
  machines: fleet.machines.map((m): Machine => {
    const system = themes[m.ts.name];
    return m.kind === "live" && system ? { ...m, metrics: { ...m.metrics, system } } : m;
  }),
});

type Hub = { readonly sent: unknown[]; push: (msg: unknown) => void; pushFleet: (next: Fleet) => void };

/*
 * Mocks the hub's fleet over both HTTP and /ws, records what the page sends on
 * the socket, and lets a test push messages to the page later.
 */
async function mockDesktopHub(page: Page, initial: Fleet): Promise<Hub> {
  let current = initial;
  let socket: WebSocketRoute | null = null;
  const sent: unknown[] = [];
  await page.route("**/api/fleet", r => r.fulfill({ json: current }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route("**/api/load?**", r => r.fulfill({ json: { range: "24h", buckets: 96, rows: [] } }));
  await page.route("**/api/host/**", r => r.fulfill({ json: null }));
  await page.route("**/api/ship/badge", r => r.fulfill({ json: { waiting: 9 } }));
  await page.routeWebSocket("**/ws", ws => {
    socket = ws;
    ws.onMessage(raw => sent.push(JSON.parse(String(raw))));
    ws.send(JSON.stringify({ type: "fleet", fleet: current } satisfies ServerMessage));
  });
  const push = (msg: unknown) => socket?.send(JSON.stringify(msg));
  return {
    sent,
    push,
    pushFleet: next => {
      current = next;
      push({ type: "fleet", fleet: next } satisfies ServerMessage);
    },
  };
}

const bodyStyle = (page: Page, prop: "backgroundColor" | "color" | "fontFamily") => page.evaluate(p => getComputedStyle(document.body)[p], prop);

/* Resolves a custom property to the color the browser actually paints, however it is spelled. */
const paint = (page: Page, variable: string) =>
  page.evaluate(v => {
    const probe = document.createElement("div");
    probe.style.color = `var(${v})`;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, variable);

const firstFamily = (stack: string) => (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");

const activeTab = (page: Page) => page.getByRole("navigation", { name: "modules" }).locator('a[aria-current="page"]');

const panel = (page: Page) => page.getByRole("complementary", { name: "mirAI" });

const desktopSubscriptions = (hub: Hub) => hub.sent.filter(m => typeof m === "object" && m !== null && "type" in m && m.type === "desktop");

test("the Desktop app takes its own machine's System theme and font, with the accent on links, the active tab and the ship badge", async ({ page }) => {
  await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT, omarikato: LATTE }));
  await page.goto("/machines?desktop=archikato");

  await expect.poll(() => bodyStyle(page, "backgroundColor")).toBe(RGB.tokyoBg);
  expect(await bodyStyle(page, "color")).toBe(RGB.tokyoFg);
  expect(firstFamily(await bodyStyle(page, "fontFamily"))).toBe("JetBrainsMono Nerd Font");
  expect(await paint(page, "--color-link")).toBe(RGB.tokyoAccent);
  expect(await paint(page, "--color-machine-2")).toBe("rgb(173, 142, 230)");

  await expect(activeTab(page)).toHaveCSS("color", RGB.tokyoAccent);
  await expect(activeTab(page)).toHaveCSS("border-bottom-color", RGB.tokyoAccent);
  await expect(page.getByLabel("9 waiting on you")).toHaveCSS("color", RGB.tokyoAccent);
});

test("status colors stay Mirai's own under a dark System theme that defines its own green", async ({ page }) => {
  await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT }));
  await page.goto("/machines?desktop=archikato");
  await expect.poll(() => bodyStyle(page, "backgroundColor")).toBe(RGB.tokyoBg);
  expect(await paint(page, "--color-ok")).toBe(RGB.darkOk);
});

test("a light System theme turns the Desktop app light and uses the darker status colors", async ({ page }) => {
  await mockDesktopHub(page, withThemes({ omarikato: LATTE }));
  await page.goto("/machines?desktop=omarikato");

  await expect.poll(() => bodyStyle(page, "backgroundColor")).toBe(RGB.latteBg);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  expect(await paint(page, "--color-ok")).toBe(RGB.lightOk);
});

test("a theme switch on the machine reaches the open Desktop app without a reload", async ({ page }) => {
  const hub = await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT }));
  await page.goto("/machines?desktop=archikato");
  await expect.poll(() => bodyStyle(page, "backgroundColor")).toBe(RGB.tokyoBg);
  await page.evaluate(() => Object.assign(window, { contractMarker: true }));

  hub.pushFleet(withThemes({ archikato: LATTE }));

  await expect.poll(() => bodyStyle(page, "backgroundColor")).toBe(RGB.latteBg);
  expect(await page.evaluate(() => "contractMarker" in window)).toBe(true);
});

test("desktop mode lasts for the life of the window, across reloads and pages", async ({ page }) => {
  await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT }));
  await page.goto("/machines?desktop=archikato");
  await expect.poll(() => bodyStyle(page, "backgroundColor")).toBe(RGB.tokyoBg);

  await page.goto("/ship");
  await expect.poll(() => bodyStyle(page, "backgroundColor")).toBe(RGB.tokyoBg);
});

test("a Desktop app on a machine with no System theme keeps Mirai's built-in look without complaint", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT }));
  await page.goto("/machines?desktop=macato");
  await expect(page.getByRole("navigation", { name: "modules" })).toBeVisible();
  await page.waitForTimeout(500);

  expect(await bodyStyle(page, "backgroundColor")).toBe(RGB.black);
  expect(await bodyStyle(page, "color")).toBe(RGB.white);
  expect(errors).toEqual([]);
});

test("the Browser tab ignores every System theme and never subscribes as a Desktop app", async ({ page }) => {
  const hub = await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT, omarikato: LATTE, macato: TOKYO_NIGHT }));
  await page.goto("/machines");
  await expect(page.getByRole("navigation", { name: "modules" })).toBeVisible();
  await page.waitForTimeout(500);

  expect(await bodyStyle(page, "backgroundColor")).toBe(RGB.black);
  expect(firstFamily(await bodyStyle(page, "fontFamily"))).toBe("Martian Mono");
  await expect(activeTab(page)).toHaveCSS("color", RGB.white);
  expect(desktopSubscriptions(hub)).toEqual([]);
});

test("?mirai=1 opens the mirAI panel with the input focused, then drops the param from the URL", async ({ page }) => {
  await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT }));
  await mockMirai(page);
  await page.goto("/machines?desktop=archikato&mirai=1");

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "ask mirAI" })).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.has("mirai")).toBe(false);
  expect(new URL(page.url()).pathname).toBe("/machines");
});

test("the Desktop app subscribes for its machine and goes wherever the launcher sends it", async ({ page }) => {
  const hub = await mockDesktopHub(page, withThemes({ archikato: TOKYO_NIGHT }));
  await mockMirai(page);
  await page.goto("/machines?desktop=archikato");
  await expect.poll(() => desktopSubscriptions(hub)).toContainEqual({ type: "desktop", machine: "archikato" });

  hub.push({ type: "open", path: "/ship" });
  await expect(page).toHaveURL(/\/ship$/);
  await expect(activeTab(page)).toHaveText(/ship/i);

  hub.push({ type: "open", path: "/tasks?mirai=1" });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/tasks");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "ask mirAI" })).toBeFocused();
});
