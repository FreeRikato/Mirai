import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");

test("derives the desktop hub URL from tailscale status when no override is set", async () => {
  const home = join(tmpdir(), `mirai-hub-discovery-${crypto.randomUUID()}`);
  const stubs = join(home, "stubs");
  mkdirSync(join(home, ".config/omarchy/extensions"), { recursive: true });
  mkdirSync(join(home, ".config/omarchy"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".config/omarchy/shell.json"), JSON.stringify({ bar: { layout: { left: [], center: [], right: [] } } }));
  writeFileSync(join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), "{}\n");
  writeFileSync(join(stubs, "tailscale"), `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ Self: { DNSName: "archikato.tail123.ts.net." } })}'\n`);
  writeFileSync(join(stubs, "omarchy-restart-shell"), "#!/bin/sh\n");
  chmodSync(join(stubs, "tailscale"), 0o755);
  chmodSync(join(stubs, "omarchy-restart-shell"), 0o755);

  const child = Bun.spawn(["bash", SCRIPT, "local"], {
    cwd: ROOT,
    env: { ...globalThis.process.env, HOME: home, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);

  const shell = JSON.parse(readFileSync(join(home, ".config/omarchy/shell.json"), "utf8"));
  expect(shell.bar.layout.right).toContainEqual({ id: "mirai.fleet", hub: "http://archikato.tail123.ts.net:3131" });
});
