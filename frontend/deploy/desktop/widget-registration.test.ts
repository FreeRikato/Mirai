import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");
const QML = join(ROOT, "deploy/desktop/Fleet.qml");

test("installs an Omarchy plugin entry with top-level settings and no unused hub file", async () => {
  const home = join(tmpdir(), `mirai-widget-registration-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy/extensions"), { recursive: true });
  mkdirSync(join(home, ".config/omarchy"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  writeFileSync(join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), "{}\n");
  const restart = join(stubs, "omarchy-restart-shell");
  writeFileSync(restart, "#!/bin/sh\n");
  chmodSync(restart, 0o755);

  const child = Bun.spawn(["bash", SCRIPT, "local"], {
    cwd: ROOT,
    env: { ...globalThis.process.env, HOME: home, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: "http://hub.example:3131" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);

  const shell = JSON.parse(readFileSync(join(home, ".config/omarchy/shell.json"), "utf8"));
  expect(shell.bar.layout.right).toContainEqual({ id: "mirai.fleet", hub: "http://hub.example:3131" });
  expect(shell.bar.layout.right.find((entry: { id: string }) => entry.id === "mirai.fleet")).not.toHaveProperty("type");
  expect(existsSync(join(home, ".config/omarchy/plugins/mirai.fleet/hub"))).toBe(false);
  expect(readFileSync(QML, "utf8")).toContain("settings && settings.hub");
});
