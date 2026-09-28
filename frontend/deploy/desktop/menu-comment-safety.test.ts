import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");

/*
 * A strict-ish JSONC parser: strips comments the same way Omarchy's own
 * MenuModel.stripJsonc does, then tolerates a trailing comma right before a
 * closing bracket (the one thing real JSONC lets through) but nothing else.
 * A comma that only exists inside a comment vanishes with the comment, so a
 * missing separator between two real values still throws here.
 */
function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

async function installWithMenu(menuBody: string): Promise<string> {
  const home = join(tmpdir(), `mirai-menu-comment-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy/extensions"), { recursive: true });
  mkdirSync(join(home, ".config/omarchy"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  const menuPath = join(home, ".config/omarchy/extensions/omarchy-menu.jsonc");
  writeFileSync(menuPath, menuBody);
  const restart = join(stubs, "omarchy-restart-shell");
  writeFileSync(restart, "#!/bin/sh\n");
  chmodSync(restart, 0o755);

  const child = Bun.spawn(["bash", SCRIPT, "local"], {
    cwd: ROOT,
    env: { ...globalThis.process.env, HOME: home, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: "http://hub.example:3131" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await child.exited;
  const stderr = await new Response(child.stderr).text();
  if (exitCode !== 0) throw new Error(`install-desktop.sh local exited ${exitCode}: ${stderr}`);
  return readFileSync(menuPath, "utf8");
}

test("a trailing comment before the closing brace does not swallow the comma the installer needs", async () => {
  const menuBody = `{
  "personal": {
    "icon": "",
    "label": "Personal"
  }
  // keep personal last
}
`;
  const text = await installWithMenu(menuBody);
  const config = parseJsonc(text) as Record<string, { label?: string }>;
  expect(config.personal?.label).toBe("Personal");
  expect(config.mirai?.label).toBe("Mirai");
});

test("a user entry with no trailing comma followed by the stock comment block still parses", async () => {
  const menuBody = `{
  "personal": {"icon":"","label":"Personal"}
  // Extend the Quickshell Omarchy menu with JSONC.
  // Example:
  // "about": {"icon":"","label":"About"},
}
`;
  const text = await installWithMenu(menuBody);
  const config = parseJsonc(text) as Record<string, { label?: string }>;
  expect(config.personal?.label).toBe("Personal");
  expect(config.mirai?.label).toBe("Mirai");
});
