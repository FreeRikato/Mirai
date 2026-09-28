import { expect, test } from "bun:test";


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
