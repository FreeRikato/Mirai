import { describe, expect, test } from "bun:test";
import { systemThemeVars } from "./systemTheme";

const LIGHT_THEME = {
  mode: "light" as const,
  monoFont: "Iosevka",
  colors: { background: "#eff1f5", foreground: "#4c4f69" },
};

describe("System theme selection contrast", () => {
  test("falls back to the theme foreground when selection is absent", () => {
    const vars = systemThemeVars(LIGHT_THEME);
    expect(vars["--color-selection"]).toBe(vars["--color-fg"]);
  });

  test("draws selected text with the normal foreground color", async () => {
    const css = await Bun.file(new URL("../../styles/globals.css", import.meta.url)).text();
    expect(css).toMatch(/::selection\s*\{[^}]*color:\s*var\(--color-fg\)/s);
  });
});
