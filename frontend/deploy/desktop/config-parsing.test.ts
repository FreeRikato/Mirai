import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");

test("adds menu entries without making an existing JSONC object invalid", async () => {
  const home = join(tmpdir(), `mirai-config-parsing-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy/extensions"), { recursive: true });
  mkdirSync(join(home, ".config/omarchy"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  const menu = join(home, ".config/omarchy/extensions/omarchy-menu.jsonc");
  writeFileSync(menu, '{\n  "personal": {"icon":"","label":"Personal"}\n}\n');
  writeFileSync(join(stubs, "omarchy-restart-shell"), "#!/bin/sh\n");
  chmodSync(join(stubs, "omarchy-restart-shell"), 0o755);

  const child = Bun.spawn(["bash", SCRIPT, "local"], {
    cwd: ROOT,
    env: { ...globalThis.process.env, HOME: home, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: "http://hub.example:3131" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);
  const config = JSON.parse(readFileSync(menu, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"));
  expect(config.personal.label).toBe("Personal");
  expect(config.mirai.label).toBe("Mirai");
});
