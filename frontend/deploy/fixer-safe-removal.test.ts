import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");

test("removal preserves user edits made after installation", async () => {
  const home = join(tmpdir(), `mirai-safe-removal-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy/extensions"), { recursive: true });
  mkdirSync(join(home, ".config/omarchy"), { recursive: true });
  mkdirSync(join(home, ".config/hypr"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  writeFileSync(join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), "{}\n");
  writeFileSync(join(stubs, "omarchy-restart-shell"), "#!/bin/sh\n");
  chmodSync(join(stubs, "omarchy-restart-shell"), 0o755);
  const env = { ...globalThis.process.env, HOME: home, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: "http://hub.example:3131" };

  const install = Bun.spawn(["bash", SCRIPT, "local"], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  expect(await install.exited).toBe(0);

  const shellPath = join(home, ".config/omarchy/shell.json");
  const shell = JSON.parse(readFileSync(shellPath, "utf8"));
  shell.bar.layout.left.push({ id: "personal.widget" });
  writeFileSync(shellPath, `${JSON.stringify(shell)}\n`);
  const bindingsPath = join(home, ".config/hypr/bindings.lua");
  const hyprlandPath = join(home, ".config/hypr/hyprland.lua");
  writeFileSync(bindingsPath, `${readFileSync(bindingsPath, "utf8")}-- user binding\n`);
  writeFileSync(hyprlandPath, `${readFileSync(hyprlandPath, "utf8")}-- user rule\n`);

  const remove = Bun.spawn(["bash", SCRIPT, "--remove", "local"], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  expect(await remove.exited).toBe(0);

  const restored = JSON.parse(readFileSync(shellPath, "utf8"));
  expect(restored.bar.layout.left).toContainEqual({ id: "personal.widget" });
  expect(restored.bar.layout.right).not.toContainEqual({ id: "mirai.fleet", hub: "http://hub.example:3131" });
  expect(readFileSync(bindingsPath, "utf8")).toContain("-- user binding");
  expect(readFileSync(hyprlandPath, "utf8")).toContain("-- user rule");
  expect(existsSync(join(home, ".config/omarchy/plugins/mirai.fleet"))).toBe(false);
});
