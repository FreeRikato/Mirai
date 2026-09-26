import { expect, test } from "@playwright/test";
import { MACHINE_HUES } from "../src/hub/fleet";

test("every machine hue token resolves", async ({ page }) => {
  await page.goto("/machines");
  const values = await page.evaluate(
    (n: number) => Array.from({ length: n }, (_, i) => getComputedStyle(document.documentElement).getPropertyValue(`--color-machine-${i + 1}`).trim()),
    MACHINE_HUES,
  );
  expect(values).toHaveLength(MACHINE_HUES);
  for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/);
});
