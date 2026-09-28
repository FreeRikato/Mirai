import { expect, test } from "bun:test";

test("keeps Mermaid theme settings in the secure configuration keys", async () => {
  const source = await Bun.file(new URL("./GithubHtml.tsx", import.meta.url)).text();
  const secure = source.match(/secure:\s*\[([^\]]+)\]/s)?.[1] ?? "";

  for (const key of ["theme", "themeVariables", "themeCSS", "darkMode", "fontFamily"]) {
    expect(secure).toContain(`"${key}"`);
  }
});
