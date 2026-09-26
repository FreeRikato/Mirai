import { expect, test, type Page } from "@playwright/test";
import { mockHub } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await mockHub(page);
});

const overflowing = (page: Page) =>
  page.evaluate(() =>
    [document.scrollingElement, document.querySelector("main"), ...document.querySelectorAll("[data-slot=table-container]")]
      .filter((el): el is Element => el !== null && el.scrollWidth > el.clientWidth + 1)
      .map(el => el.tagName + (el.getAttribute("data-slot") ?? "")),
  );

test("no page scrolls sideways on a phone", async ({ page }) => {
  await page.goto("/machines");
  await expect(page.getByRole("heading", { level: 1, name: "fleet" })).toBeVisible();
  expect(await overflowing(page)).toEqual([]);

  await page.goto("/machines/omarikato");
  await expect(page.getByRole("cell", { name: /hermes-gateway/ })).toBeVisible();
  expect(await overflowing(page)).toEqual([]);
  await page.getByRole("tab", { name: "ports" }).tap();
  await expect(page.getByRole("cell", { name: /:5437/ })).toBeVisible();
  expect(await overflowing(page)).toEqual([]);
});

test("the menu opens the machine list; picking a machine opens it and closes the drawer", async ({ page }) => {
  await page.goto("/machines");
  await expect(page.getByRole("complementary")).toBeHidden();
  await page.getByRole("button", { name: "open navigation" }).tap();
  const drawer = page.getByRole("dialog", { name: "mirai" });
  await drawer.getByRole("link", { name: /omarikato/ }).tap();
  await expect(page).toHaveURL(/\/machines\/omarikato$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "omarikato" })).toBeVisible();
});

test("on a phone the kill button shows without hover and confirms in a bottom sheet", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/host/omarikato/kill", r => {
    sent.push(r.request().postDataJSON());
    return r.fulfill({ json: { pid: 48213, name: "node", signal: "SIGKILL" } });
  });
  await page.goto("/machines/omarikato");
  const kill = page.getByRole("button", { name: "kill node (48213)" });
  await expect(kill).toHaveCSS("opacity", "1");
  await kill.tap();
  const sheet = page.getByRole("dialog", { name: "kill node?" });
  await expect(sheet).toHaveAttribute("data-slot", "sheet-content");
  await sheet.getByRole("button", { name: "force kill" }).tap();
  await expect(sheet).toBeHidden();
  expect(sent).toEqual([{ pid: 48213, name: "node", signal: "SIGKILL" }]);
});
