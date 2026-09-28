import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runDoctor, type Check } from "./checks";

setDefaultTimeout(60_000);

/*
 * The doctor reads the Desktop app setup from env.HOME, so each case builds a
 * throwaway home: one that is not Omarchy, one that is Omarchy without Mirai,
 * and one where deploy/install-desktop.sh has run. Commands that would reach
 * the live session are logging stubs on PATH.
 */
const FRONTEND = join(import.meta.dir, "../..");
const SCRIPT = join(FRONTEND, "deploy/install-desktop.sh");
const root = mkdtempSync(join(tmpdir(), "mirai-doctor-desktop-"));
const stubs = join(root, "stubs");

const STUBS = ["hyprctl", "notify-send", "omarchy-notification-send", "omarchy-shell", "omarchy-restart-shell", "omarchy-refresh-shell", "qs", "quickshell", "makoctl", "systemctl", "loginctl", "pkill", "ssh", "scp", "sudo", "xdg-open", "xdg-settings", "uwsm-app", "omarchy-launch-webapp", "wl-paste"];

function write(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

const tsStatus = { Version: "1", Self: { ID: "s", DNSName: "box.tail0000.ts.net.", HostName: "box", OS: "linux", Online: true, TailscaleIPs: ["127.0.0.1"] } };
write(join(stubs, "tailscale"), `#!/bin/sh\ncase "$1" in status) echo '${JSON.stringify(tsStatus)}';; ip) echo 127.0.0.1;; esac\n`);
chmodSync(join(stubs, "tailscale"), 0o755);
for (const name of STUBS) {
  write(join(stubs, name), name === "hyprctl" ? `#!/bin/sh\nfor a in "$@"; do [ "$a" = clients ] && echo '[]'; done\nexit 0\n` : "#!/bin/sh\nexit 0\n");
  chmodSync(join(stubs, name), 0o755);
}

const system = { mode: "dark", colors: { background: "#1a1b26", foreground: "#a9b1d6", accent: "#7aa2f7" }, monoFont: "JetBrainsMono Nerd Font" };
const hubState = { reportsTheme: true };
const hub = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: req => {
    const path = new URL(req.url).pathname;
    if (path === "/metrics") return Response.json({});
    if (path === "/api/fleet") {
      const metrics = { cpu: { load: 12.4 }, ...(hubState.reportsTheme ? { system } : {}) };
      return Response.json({ at: 1, tailnet: "tail0000.ts.net", edges: [], latestVersion: null, machines: [{ kind: "live", color: "#fff", ts: { name: "box" }, metrics }] });
    }
    return Response.json({ delivered: 0 });
  },
});
const HUB = `http://127.0.0.1:${hub.port}`;

afterAll(() => {
  hub.stop(true);
  rmSync(root, { recursive: true, force: true });
});

function omarchyHome(name: string): string {
  const home = join(root, name);
  write(join(home, ".config/hypr/hyprland.lua"), 'require("default.hypr.omarchy")\nrequire("hypr.bindings")\n');
  write(join(home, ".config/hypr/bindings.lua"), 'o.bind("SUPER + Q", "Close window", hl.dsp.window.close())\n');
  write(join(home, ".config/omarchy/shell.json"), JSON.stringify({ version: 1, bar: { position: "top", layout: { left: [{ id: "omarchy.menu" }], center: [{ id: "omarchy.clock" }], right: [{ id: "omarchy.power" }] } } }, null, 2) + "\n");
  write(join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), "{\n  // user entries\n}\n");
  write(join(home, ".local/state/omarchy/current/theme/colors.toml"), 'mode = "dark"\n');
  return home;
}

function vars(home: string): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(HOME|PATH|WAYLAND_DISPLAY|DISPLAY|HYPRLAND_INSTANCE_SIGNATURE|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME|XDG_CACHE_HOME|MIRAI_DESKTOP_HUB)$/.test(k)) continue;
    base[k] = v;
  }
  mkdirSync(join(root, "run"), { recursive: true });
  return { ...base, HOME: home, XDG_RUNTIME_DIR: join(root, "run"), PATH: `${stubs}:${home}/.local/bin:${process.env.PATH ?? "/usr/bin:/bin"}` };
}

async function installInto(home: string) {
  const out = join(root, "install.log");
  const p = Bun.spawn(["bash", SCRIPT, "local"], { cwd: FRONTEND, env: { ...vars(home), MIRAI_DESKTOP_HUB: HUB }, stdout: Bun.file(out), stderr: Bun.file(out) });
  const code = await p.exited;
  if (code !== 0) throw new Error(`install-desktop.sh local exited ${code}:\n${existsSync(out) ? readFileSync(out, "utf8") : ""}`);
}

const doctor = (home: string) => runDoctor({ env: { HOME: home, TAILSCALE_BIN: join(stubs, "tailscale"), MIRAI_AGENT_PORT: String(hub.port) }, root: FRONTEND, hubUrl: HUB, githubToken: async () => null });

const DESKTOP = { webApp: /web ?app/i, bindings: /binding/i, widget: /widget/i, theme: /theme/i } as const;

const find = (checks: readonly Check[], pattern: RegExp) => {
  const found = checks.filter(c => pattern.test(c.name));
  expect({ pattern: String(pattern), count: found.length }).toEqual({ pattern: String(pattern), count: 1 });
  return found[0];
};

describe("bun run doctor on a Desktop app machine", () => {
  const home = omarchyHome("installed");
  beforeAll(() => installInto(home));

  test("reports the web app, the bindings, the bar widget and the System theme as ok once installed", async () => {
    hubState.reportsTheme = true;
    const checks = await doctor(home);
    for (const pattern of Object.values(DESKTOP)) expect({ pattern: String(pattern), status: find(checks, pattern)?.status }).toEqual({ pattern: String(pattern), status: "ok" });
  });

  test("flags a machine whose agent does not report the System theme", async () => {
    hubState.reportsTheme = false;
    const checks = await doctor(home);
    expect(["warn", "fail"]).toContain(find(checks, DESKTOP.theme)?.status ?? "missing");
    hubState.reportsTheme = true;
  });
});

describe("bun run doctor on an Omarchy machine without the Desktop app", () => {
  test("flags the missing web app, bindings and bar widget and says how to install them", async () => {
    const checks = await doctor(omarchyHome("bare"));
    for (const pattern of [DESKTOP.webApp, DESKTOP.bindings, DESKTOP.widget]) {
      const check = find(checks, pattern);
      expect({ pattern: String(pattern), flagged: check?.status === "warn" || check?.status === "fail" }).toEqual({ pattern: String(pattern), flagged: true });
      expect(check?.detail).toContain("install-desktop.sh");
    }
  });
});

describe("bun run doctor on a machine that is not Omarchy", () => {
  test("raises no desktop warnings at all", async () => {
    const home = join(root, "plain");
    mkdirSync(home, { recursive: true });
    const checks = await doctor(home);
    const desktop = checks.filter(c => Object.values(DESKTOP).some(p => p.test(c.name)));
    expect(desktop.filter(c => c.status === "warn" || c.status === "fail")).toEqual([]);
  });
});
