import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");

/*
 * --remove must take out only what the installer added: a marked block from
 * a shared file, an entry from shell.json by id, its own files. It must
 * never restore or delete a whole-file snapshot of a user's config, even for
 * a file Mirai itself created, once the user has added their own content to
 * it.
 */

function env(home: string, stubs: string) {
  return { ...globalThis.process.env, HOME: home, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: "http://hub.example:3131" };
}

async function run(cmd: string[], home: string, stubs: string) {
  const child = Bun.spawn(cmd, { cwd: ROOT, env: env(home, stubs), stdout: "pipe", stderr: "pipe" });
  const exitCode = await child.exited;
  const stderr = await new Response(child.stderr).text();
  return { exitCode, stderr };
}

test("--remove deletes the menu file it created only while it holds nothing but Mirai's block, and keeps it once the user adds their own entry", async () => {
  const home = join(tmpdir(), `mirai-remove-menu-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy"), { recursive: true });
  mkdirSync(join(home, ".config/hypr"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  writeFileSync(join(home, ".config/hypr/bindings.lua"), "-- user bindings\n");
  writeFileSync(join(home, ".config/hypr/hyprland.lua"), "-- user hyprland\n");
  const restart = join(stubs, "omarchy-restart-shell");
  writeFileSync(restart, "#!/bin/sh\n");
  chmodSync(restart, 0o755);

  const menu = join(home, ".config/omarchy/extensions/omarchy-menu.jsonc");
  expect(existsSync(menu)).toBe(false);

  const firstInstall = await run(["bash", SCRIPT, "local"], home, stubs);
  expect(firstInstall.exitCode).toBe(0);
  expect(existsSync(menu)).toBe(true);

  const cleanRemove = await run(["bash", SCRIPT, "--remove", "local"], home, stubs);
  expect(cleanRemove.exitCode).toBe(0);
  expect(existsSync(menu)).toBe(false);

  const secondInstall = await run(["bash", SCRIPT, "local"], home, stubs);
  expect(secondInstall.exitCode).toBe(0);
  expect(existsSync(menu)).toBe(true);
  const withUserEntry = readFileSync(menu, "utf8").replace(/\n\}\n$/, '\n  "mine": {"icon":"","label":"Mine"}\n}\n');
  writeFileSync(menu, withUserEntry);

  const editedRemove = await run(["bash", SCRIPT, "--remove", "local"], home, stubs);
  expect(editedRemove.exitCode).toBe(0);
  expect(existsSync(menu)).toBe(true);
  const remaining = readFileSync(menu, "utf8");
  expect(remaining).toContain('"mine"');
  expect(remaining).not.toContain("MIRAI DESKTOP");
});

test("--remove deletes bindings.lua it created only while untouched, and keeps a line the user added afterward", async () => {
  const home = join(tmpdir(), `mirai-remove-bindings-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy/extensions"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  writeFileSync(join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), "{}\n");
  const restart = join(stubs, "omarchy-restart-shell");
  writeFileSync(restart, "#!/bin/sh\n");
  chmodSync(restart, 0o755);

  const bindings = join(home, ".config/hypr/bindings.lua");
  expect(existsSync(bindings)).toBe(false);

  const install = await run(["bash", SCRIPT, "local"], home, stubs);
  expect(install.exitCode).toBe(0);
  expect(existsSync(bindings)).toBe(true);
  writeFileSync(bindings, `${readFileSync(bindings, "utf8")}-- my own binding\n`);

  const remove = await run(["bash", SCRIPT, "--remove", "local"], home, stubs);
  expect(remove.exitCode).toBe(0);
  expect(existsSync(bindings)).toBe(true);
  const remaining = readFileSync(bindings, "utf8");
  expect(remaining).toContain("-- my own binding");
  expect(remaining).not.toContain("MIRAI DESKTOP");
});
