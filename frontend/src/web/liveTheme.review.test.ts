import { expect, test } from "bun:test";
import { applySystemTheme } from "./systemTheme";
import { useUi } from "./store";

function readThemeVersion(state: unknown): number | undefined {
  if (typeof state !== "object" || state === null || !("themeVersion" in state)) return undefined;
  const value = state.themeVersion;
  return typeof value === "number" ? value : undefined;
}

test("publishes every System theme change for surfaces that read colors in JavaScript", () => {
  const before = readThemeVersion(useUi.getState()) ?? 0;
  const seen: number[] = [];
  const unsubscribe = useUi.subscribe(state => {
    const version = readThemeVersion(state);
    if (version !== undefined && version > before) seen.push(version);
  });
  const previousDocument = globalThis.document;
  const style = {
    colorScheme: "dark",
    removeProperty: (_name: string) => {},
    setProperty: (_name: string, _value: string) => {},
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { style } } });
  try {
    applySystemTheme(undefined);
    expect(readThemeVersion(useUi.getState())).toBe(before + 1);
    expect(seen).toEqual([before + 1]);
  } finally {
    unsubscribe();
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
  }
});

test("reconfigures Mermaid with the current System theme for each render", async () => {
  const github = await Bun.file(new URL("./ship/GithubHtml.tsx", import.meta.url)).text();
  expect(github).toMatch(/function mermaidConfig\(\)/);
  expect(github).toMatch(/renderMermaidBlocks[\s\S]*mermaid\.initialize\(mermaidConfig\(\)\)/);
});

test("updates a reader iframe's theme variables without rebuilding its document", async () => {
  const reader = await Bun.file(new URL("./later/Reader.tsx", import.meta.url)).text();
  expect(reader).toContain("function applyReaderTheme");
  expect(reader).toContain("applyReaderTheme(root, theme)");
  expect(reader).toContain("readerDoc(data.html, item)");
  expect(reader).not.toContain("readerDoc(data.html, item, theme)");
});
