import { describe, expect, test } from "bun:test";
import { editorTheme } from "./editor/theme";
import { systemThemeVars } from "./systemTheme";

const LIGHT_THEME = {
  mode: "light" as const,
  monoFont: "Iosevka",
  colors: { accent: "#1e66f5", background: "#eff1f5", foreground: "#4c4f69" },
};

function editorRules(): string {
  const extensions = editorTheme("compact") as unknown as Array<{ value?: { rules?: string[] } }>;
  return extensions.find(extension => Array.isArray(extension.value?.rules))?.value?.rules?.join("\n") ?? "";
}

describe("light System theme surfaces", () => {
  test("fills the shadcn accent token from the System theme palette", () => {
    const vars = systemThemeVars(LIGHT_THEME);
    expect(vars["--color-accent"]).toBe("var(--color-selection)");
  });

  test("keeps the editor palette on theme variables", () => {
    const rules = editorRules();
    expect(rules).toContain("color: var(--color-fg)");
    expect(rules).toContain("background-color: var(--color-popover)");
    expect(rules).toContain("background-color: var(--color-accent)");
    expect(rules).not.toContain("#ffffff");
    expect(rules).not.toContain("#161616");
  });

  test("keeps social content text and separators on theme variables", async () => {
    const source = await Bun.file(new URL("./later/SocialView.tsx", import.meta.url)).text();
    expect(source).toContain("text-soft");
    expect(source).toContain("border-rule");
    expect(source).not.toContain("text-[#ececec]");
    expect(source).not.toContain("text-[#e6e6e6]");
    expect(source).not.toContain("border-[#2a2a2a]");
  });
});
