import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");

function setup(menuText: string | null) {
  const home = join(tmpdir(), `mirai-config-parsing-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy/extensions"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  const menu = join(home, ".config/omarchy/extensions/omarchy-menu.jsonc");
  if (menuText !== null) writeFileSync(menu, menuText);
  writeFileSync(join(stubs, "omarchy-restart-shell"), "#!/bin/sh\n");
  chmodSync(join(stubs, "omarchy-restart-shell"), 0o755);
  const run = async (...args: string[]) => {
    const child = Bun.spawn(["bash", SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...globalThis.process.env, HOME: home, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: "http://hub.example:3131" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return child.exited;
  };
  return { menu, run };
}

/* Omarchy reads the menu as JSONC: whole-line comments and trailing commas are allowed. */
const parseMenu = (text: string): Record<string, { label?: string }> =>
  JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"));

test("adds menu entries without making an existing JSONC object invalid", async () => {
  const { menu, run } = setup('{\n  "personal": {"icon":"","label":"Personal"}\n}\n');
  expect(await run("local")).toBe(0);
  const config = parseMenu(readFileSync(menu, "utf8"));
  expect(config.personal?.label).toBe("Personal");
  expect(config.mirai?.label).toBe("Mirai");
});

test("a leading comment that mentions a brace is left alone and the entries go into the object", async () => {
  const note = '// Format: {"id": {"label": "..."}}';
  const { menu, run } = setup(`${note}\n{\n  "personal": {"icon":"","label":"Personal"}\n}\n`);
  expect(await run("local")).toBe(0);
  const text = readFileSync(menu, "utf8");
  expect(text.split("\n")[0]).toBe(note);
  const config = parseMenu(text);
  expect(config.personal?.label).toBe("Personal");
  expect(config.mirai?.label).toBe("Mirai");
});

test("--remove keeps a menu file Mirai created once the user has written in it", async () => {
  const { menu, run } = setup(null);
  expect(await run("local")).toBe(0);
  const note = '  // "work": {"label": "Work"}, my notes for later';
  writeFileSync(menu, readFileSync(menu, "utf8").replace("{\n", `{\n${note}\n`));
  expect(await run("--remove", "local")).toBe(0);
  expect(existsSync(menu)).toBe(true);
  expect(readFileSync(menu, "utf8")).toContain(note);
});

test("--remove deletes a menu file Mirai created when the user never touched it", async () => {
  const { menu, run } = setup(null);
  expect(await run("local")).toBe(0);
  expect(await run("--remove", "local")).toBe(0);
  expect(existsSync(menu)).toBe(false);
});
