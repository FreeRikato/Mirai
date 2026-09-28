import { describe, expect, test } from "bun:test";
import { systemThemeVars } from "./systemTheme";

const LIGHT_THEME = {
  mode: "light" as const,
  monoFont: "Iosevka",
  colors: { background: "#eff1f5", foreground: "#4c4f69" },
};

describe("System theme selection contrast", () => {
  test("falls back to a subtle foreground mix when selection is absent", () => {
    const vars = systemThemeVars(LIGHT_THEME);
    expect(vars["--color-selection"]).toBe("color-mix(in srgb, var(--color-fg) 25%, var(--color-bg))");
    expect(vars["--color-selection-text"]).toBe("var(--color-fg)");
  });

  test("keeps the built-in selection text/background split without a System theme", async () => {
    const css = await Bun.file(new URL("../../styles/globals.css", import.meta.url)).text();
    expect(css).toMatch(/::selection\s*\{[^}]*background:\s*var\(--color-selection,\s*var\(--color-fg\)\)/s);
    expect(css).toMatch(/::selection\s*\{[^}]*color:\s*var\(--color-selection-text,\s*var\(--color-bg\)\)/s);
  });
});
