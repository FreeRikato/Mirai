import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "deploy/install-desktop.sh");

test("copies desktop assets into the directory the remote installer reads", async () => {
  const root = join(tmpdir(), `mirai-remote-install-${crypto.randomUUID()}`);
  const stubs = join(root, "stubs");
  const log = join(root, "calls");
  mkdirSync(stubs, { recursive: true });
  const ssh = join(stubs, "ssh");
  const scp = join(stubs, "scp");
  writeFileSync(ssh, `#!/bin/sh\nprintf 'ssh %s\\n' "$*" >> "${log}"\n`);
  writeFileSync(scp, `#!/bin/sh\nprintf 'scp %s\\n' "$*" >> "${log}"\n`);
  chmodSync(ssh, 0o755);
  chmodSync(scp, 0o755);

  const child = Bun.spawn(["bash", SCRIPT, "test-host"], {
    cwd: ROOT,
    env: { ...globalThis.process.env, PATH: `${stubs}:${globalThis.process.env.PATH}`, MIRAI_DESKTOP_HUB: "http://hub.example:3131" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);

  const calls = readFileSync(log, "utf8");
  expect(calls).toMatch(/scp .*install-desktop\.sh .*test-host:\/tmp\/mirai-desktop-install-[0-9]+\//);
  expect(calls).toMatch(/scp .*manifest\.json .*test-host:\/tmp\/mirai-desktop-install-[0-9]+\/desktop\//);
  expect(calls).toMatch(/scp .*Fleet\.qml .*test-host:\/tmp\/mirai-desktop-install-[0-9]+\/desktop\//);
  expect(calls).toMatch(/scp .*fleet\.mjs .*test-host:\/tmp\/mirai-desktop-install-[0-9]+\/desktop\//);
});
