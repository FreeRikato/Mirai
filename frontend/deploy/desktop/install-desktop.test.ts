import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

setDefaultTimeout(60_000);

/*
 * Every test runs deploy/install-desktop.sh against a throwaway HOME. Commands
 * that would reach the live session (hyprctl, the Omarchy shell, notifications,
 * browsers, the clipboard, tailscale, ssh) are stubs on PATH that log their
 * arguments, so the tests read what the script and the launcher asked for.
 */
const FRONTEND = join(import.meta.dir, "../..");
const SCRIPT = join(FRONTEND, "deploy/install-desktop.sh");
const ICON = readFileSync(join(FRONTEND, "public/icons/icon-512.png"));
const MACHINE = hostname();
const MIRAI_WINDOW = "0xm1r41";

const STUBS = [
  "hyprctl",
  "tailscale",
  "wl-paste",
  "wl-copy",
  "notify-send",
  "omarchy-notification-send",
  "omarchy-shell",
  "omarchy-restart-shell",
  "omarchy-refresh-shell",
  "qs",
  "quickshell",
  "makoctl",
  "systemctl",
  "loginctl",
  "pkill",
  "ssh",
  "scp",
  "sudo",
  "xdg-open",
  "xdg-settings",
  "uwsm-app",
  "omarchy-launch-webapp",
  "omarchy-launch-or-focus",
  "omarchy-launch-or-focus-webapp",
  "chromium",
  "chromium-browser",
  "google-chrome-stable",
  "brave",
] as const;

const LAUNCHERS = new Set(["uwsm-app", "omarchy-launch-webapp", "omarchy-launch-or-focus", "omarchy-launch-or-focus-webapp", "chromium", "chromium-browser", "google-chrome-stable", "brave", "xdg-open"]);
const NOTIFIERS = new Set(["notify-send", "omarchy-notification-send"]);

const HYPRLAND_LUA = `-- Learn how to configure Hyprland: https://wiki.hypr.land/Configuring/Start/
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")
require("default.hypr.omarchy")
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")
require("default.hypr.toggles")

-- Add any other personal Hyprland configuration below.
-- o.window("qemu", { workspace = "5" })
`;

const BINDINGS_LUA = `-- Keep only your personal keybinding overrides here.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

hl.unbind("SUPER + W")
o.bind("SUPER + Q", "Close window", hl.dsp.window.close())
`;

const LOOKNFEEL_LUA = `hl.config({ general = { gaps_in = 5, gaps_out = 10 } })
`;

const MENU_JSONC = `{
  // Extend the Quickshell Omarchy menu with JSONC.
  //
  // IDs are object keys. The parent is inferred from the dotted id.
  "personal": {"icon":"","label":"Personal"},
  "personal.notes": {"icon":"󰎞","label":"Notes","action":"omarchy-launch-editor ~/notes"},
  // "about": {"icon":"","label":"About"},
}
`;

type Entry = { readonly id: string } & Readonly<Record<string, unknown>>;
type Layout = { left: Entry[]; center: Entry[]; right: Entry[] };

const shellJson = (layout: Layout) => ({ version: 1, bar: { position: "top", transparent: false, centerAnchor: "omarchy.clock", layout }, plugins: [{ id: "tenzin.live-wallpaper" }] });

const DEFAULT_LAYOUT: Layout = {
  left: [{ id: "omarchy.menu" }, { id: "omarchy.workspaces" }],
  center: [{ id: "omarchy.indicators" }, { id: "omarchy.clock", format: "dddd HH:mm" }, { id: "omarchy.weather" }],
  right: [{ id: "omarchy.tray" }, { id: "rikato.aws-sandbox-status" }, { id: "omarchy.network" }, { id: "omarchy.audio" }, { id: "omarchy.power" }],
};

const CLOCK_RIGHT_LAYOUT: Layout = {
  left: [{ id: "omarchy.menu" }, { id: "omarchy.workspaces" }],
  center: [{ id: "omarchy.indicators" }],
  right: [{ id: "omarchy.tray" }, { id: "omarchy.network" }, { id: "omarchy.clock", format: "HH:mm" }, { id: "omarchy.power" }],
};

type Call = { readonly cmd: string; readonly args: readonly string[] };
type HubRequest = { readonly method: string; readonly path: string; readonly contentType: string; readonly body: unknown };

type Env = {
  readonly root: string;
  readonly home: string;
  readonly stubs: string;
  readonly log: string;
  calls: () => Call[];
  clearCalls: () => void;
  vars: (extra?: Record<string, string>) => Record<string, string>;
};

/* A fake hub that records every request and answers the two endpoints the desktop side uses. */
const hubState: { delivered: number; saveError: string | null; requests: HubRequest[] } = { delivered: 1, saveError: null, requests: [] };
const hub = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async req => {
    const url = new URL(req.url);
    const text = await req.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    hubState.requests.push({ method: req.method, path: url.pathname, contentType: req.headers.get("content-type") ?? "", body });
    if (url.pathname === "/api/desktop/open") return Response.json({ delivered: hubState.delivered });
    if (url.pathname === "/api/later" && req.method === "POST") {
      return hubState.saveError ? Response.json({ error: hubState.saveError }, { status: 400 }) : Response.json({ id: "item-1" }, { status: 201 });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});
const HUB = `http://127.0.0.1:${hub.port}`;
const envs: Env[] = [];

afterAll(() => {
  hub.stop(true);
  for (const e of envs) rmSync(e.root, { recursive: true, force: true });
});

function write(path: string, body: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function makeEnv(layout: Layout = DEFAULT_LAYOUT): Env {
  const root = mkdtempSync(join(tmpdir(), "mirai-desktop-"));
  const home = join(root, "home");
  const stubs = join(root, "stubs");
  const log = join(root, "calls.log");
  write(join(home, ".config/hypr/hyprland.lua"), HYPRLAND_LUA);
  write(join(home, ".config/hypr/bindings.lua"), BINDINGS_LUA);
  write(join(home, ".config/hypr/looknfeel.lua"), LOOKNFEEL_LUA);
  write(join(home, ".config/omarchy/shell.json"), JSON.stringify(shellJson(layout), null, 2) + "\n");
  write(join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), MENU_JSONC);
  write(join(home, ".local/state/omarchy/current/theme/colors.toml"), 'mode = "dark"\nbackground = "#000000"\n');
  write(join(stubs, "clients.json"), "[]");
  const tsStatus = JSON.stringify({ Version: "1.102.3", Self: { ID: "s", HostName: MACHINE, DNSName: `${MACHINE.toLowerCase()}.tail0000.ts.net.`, OS: "linux", Online: true, TailscaleIPs: ["100.64.0.20"] }, Peer: {} });
  write(join(stubs, "tailscale.json"), tsStatus);
  const logLine = `{ printf '%s' "$(basename "$0")"; for a in "$@"; do printf '\\037%s' "$a"; done; printf '\\n'; } >> '${log}'`;
  for (const name of STUBS) {
    const extra =
      name === "hyprctl"
        ? `for a in "$@"; do [ "$a" = clients ] && cat '${join(stubs, "clients.json")}'; done`
        : name === "tailscale"
          ? `case "$1" in status) cat '${join(stubs, "tailscale.json")}';; ip) echo 100.64.0.20;; esac`
          : name === "wl-paste"
            ? `[ -f '${join(stubs, "clipboard")}' ] || { echo "No selection" >&2; exit 1; }; cat '${join(stubs, "clipboard")}'`
            : "";
    write(join(stubs, name), `#!/bin/sh\n${logLine}\n${extra}\nexit 0\n`);
    chmodSync(join(stubs, name), 0o755);
  }
  const vars = (extra: Record<string, string> = {}) => {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined || /^(HOME|PATH|WAYLAND_DISPLAY|DISPLAY|HYPRLAND_INSTANCE_SIGNATURE|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME|XDG_CACHE_HOME|MIRAI_DESKTOP_HUB)$/.test(k)) continue;
      base[k] = v;
    }
    return { ...base, HOME: home, XDG_RUNTIME_DIR: join(root, "run"), PATH: `${stubs}:${home}/.local/bin:${process.env.PATH ?? "/usr/bin:/bin"}`, ...extra };
  };
  mkdirSync(join(root, "run"), { recursive: true });
  const env: Env = {
    root,
    home,
    stubs,
    log,
    vars,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter(Boolean)
            .map(line => {
              const [cmd = "", ...args] = line.split("\x1f");
              return { cmd, args };
            })
        : [],
    clearCalls: () => rmSync(log, { force: true }),
  };
  envs.push(env);
  return env;
}

/*
 * Children run async with output in a file: the fake hub lives in this
 * process, so a blocking spawn would deadlock the first request it gets, and
 * a detached grandchild holding a pipe open would hang a read.
 */
async function run(env: Env, cmd: readonly string[], vars: Record<string, string>): Promise<{ exitCode: number | null; output: string }> {
  const out = join(env.root, "out.log");
  rmSync(out, { force: true });
  const p = Bun.spawn([...cmd], { cwd: env.home, env: vars, stdout: Bun.file(out), stderr: Bun.file(out) });
  const exitCode = await p.exited;
  return { exitCode, output: existsSync(out) ? readFileSync(out, "utf8") : "" };
}

async function install(env: Env, ...args: string[]) {
  const { exitCode, output } = await run(env, ["bash", SCRIPT, ...args], env.vars({ MIRAI_DESKTOP_HUB: HUB }));
  if (exitCode !== 0) throw new Error(`install-desktop.sh ${args.join(" ")} exited ${exitCode}:\n${output}`);
}

/* The files under HOME, minus backups and caches that tools regenerate. JSON files compare by value. */
function snapshot(home: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = relative(home, path);
      if (/\.bak|\.cache$|~$/.test(name)) continue;
      const st = lstatSync(path);
      if (st.isSymbolicLink()) out[rel] = `-> ${readlinkSync(path)}`;
      else if (st.isDirectory()) walk(path);
      else if (name.endsWith(".json")) out[rel] = JSON.stringify(JSON.parse(readFileSync(path, "utf8")));
      else out[rel] = readFileSync(path).toString("base64");
    }
  };
  walk(home);
  return out;
}

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

type MenuItem = { readonly id: string; readonly label: string; readonly action: string | null };

function menu(home: string): MenuItem[] {
  const raw = parseJsonc(readFileSync(join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error("menu extensions are not an object");
  return Object.entries(raw).map(([id, v]: [string, unknown]) => {
    const item = typeof v === "object" && v !== null ? v : {};
    const label = "label" in item && typeof item.label === "string" ? item.label : "";
    const action = "action" in item && typeof item.action === "string" ? item.action : null;
    return { id, label, action };
  });
}

const childrenOf = (items: readonly MenuItem[], parent: string) => items.filter(i => i.id.startsWith(`${parent}.`) && !i.id.slice(parent.length + 1).includes("."));

function miraiMenu(home: string) {
  const items = menu(home);
  const root = items.filter(i => i.label === "Mirai" && i.action === null);
  expect(root.map(i => i.label)).toEqual(["Mirai"]);
  const id = root[0]?.id ?? "";
  const children = childrenOf(items, id);
  const byLabel = (label: string) => children.find(c => c.label === label);
  const goTo = byLabel("Go to");
  return { items, children, byLabel, goTo: goTo ? childrenOf(items, goTo.id) : [] };
}

/* Lines present after install that were not there before, per file under ~/.config/hypr. */
function addedHyprLines(before: Record<string, string>, home: string): string[] {
  const after = snapshot(home);
  const lines = (b64: string | undefined) => (b64 === undefined ? [] : Buffer.from(b64, "base64").toString("utf8").split("\n"));
  const added: string[] = [];
  for (const [rel, body] of Object.entries(after)) {
    if (!rel.startsWith(".config/hypr/")) continue;
    const old = lines(before[rel]);
    for (const line of lines(body)) {
      const at = old.indexOf(line);
      if (at >= 0) old.splice(at, 1);
      else added.push(line);
    }
  }
  return added;
}

const code = (line: string) => line.replace(/--.*$/, "").replace(/#.*$/, "");

function desktopEntry(home: string): Record<string, string> {
  const dir = join(home, ".local/share/applications");
  const entries = existsSync(dir)
    ? readdirSync(dir)
        .filter(f => f.endsWith(".desktop"))
        .map(f => Object.fromEntries(readFileSync(join(dir, f), "utf8").split("\n").flatMap(l => (/^[A-Za-z]+=/.test(l) ? [[l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]] : []))))
        .filter(e => e.Name === "Mirai")
    : [];
  expect(entries).toHaveLength(1);
  return entries[0] ?? {};
}

function launcherPath(env: Env): string {
  const exec = desktopEntry(env.home).Exec ?? "";
  const first = (exec.match(/^"([^"]+)"|^(\S+)/) ?? []).slice(1).find(Boolean) ?? "";
  const expanded = first.replace(/^~(?=\/)/, env.home).replace(/^\$HOME(?=\/)/, env.home);
  const candidates = expanded.includes("/") ? [expanded] : [join(env.home, ".local/bin", expanded), join(env.home, "bin", expanded)];
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error(`the Mirai web app runs ${exec}, and no launcher was found at ${candidates.join(" or ")}`);
  return found;
}

function iconBytes(home: string, icon: string): Buffer | null {
  if (icon.startsWith("/")) return existsSync(icon) ? readFileSync(icon) : null;
  const base = join(home, ".local/share/icons");
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop() ?? "";
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (lstatSync(path).isDirectory()) stack.push(path);
      else if (name === `${icon}.png`) return readFileSync(path);
    }
  }
  return null;
}

async function eventually<T>(read: () => T, done: (v: T) => boolean, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  let v = read();
  while (!done(v) && Date.now() < until) {
    await Bun.sleep(50);
    v = read();
  }
  return v;
}

const launchedUrls = (env: Env): URL[] =>
  env
    .calls()
    .filter(c => LAUNCHERS.has(c.cmd))
    .flatMap(c => c.args)
    .map(a => a.replace(/^--app=/, ""))
    .filter(a => a.startsWith(HUB))
    .map(a => new URL(a));

const notifications = (env: Env) =>
  env
    .calls()
    .filter(c => NOTIFIERS.has(c.cmd))
    .map(c => c.args.join(" "));

function setWindows(env: Env, miraiOpen: boolean) {
  const other = { address: "0xg1th0b", class: "chromium", initialClass: "chromium", title: "GitHub - Chromium", initialTitle: "GitHub - Chromium", workspace: { id: 2, name: "2" }, pid: 4242 };
  const appClass = `chrome-${new URL(HUB).hostname}__machines-Default`;
  const mirai = { address: MIRAI_WINDOW, class: appClass, initialClass: appClass, title: "mirai", initialTitle: "mirai", workspace: { id: 3, name: "3" }, pid: 4343 };
  write(join(env.stubs, "clients.json"), JSON.stringify(miraiOpen ? [other, mirai] : [other]));
}

async function runLauncher(env: Env, path: string) {
  env.clearCalls();
  hubState.requests = [];
  const { exitCode, output } = await run(env, [launcherPath(env), path], env.vars());
  if (exitCode !== 0) throw new Error(`mirai-desktop-open ${path} exited ${exitCode}: ${output}`);
}

const opens = () => hubState.requests.filter(r => r.path === "/api/desktop/open");
const focusedMirai = (env: Env) => env.calls().some(c => c.cmd === "hyprctl" && c.args.includes("dispatch") && c.args.some(a => a.includes(MIRAI_WINDOW)));

describe("install-desktop.sh local on an Omarchy machine", () => {
  const env = makeEnv();
  let before: Record<string, string> = {};
  let installed: Record<string, string> = {};

  beforeAll(async () => {
    before = snapshot(env.home);
    await install(env, "local");
    installed = snapshot(env.home);
  });

  test("registers a web app named Mirai with Mirai's own icon that starts through the launcher", () => {
    const entry = desktopEntry(env.home);
    expect(entry.Exec).toContain("mirai-desktop-open");
    expect(iconBytes(env.home, entry.Icon ?? "")?.equals(ICON)).toBe(true);
  });

  test("binds SUPER+M to the launcher on /machines and SUPER+ALT+M to the same plus the mirAI panel", () => {
    const added = addedHyprLines(before, env.home).map(code);
    expect(added.join("\n")).toContain("mirai-desktop-open");
    const superM = added.filter(l => /SUPER\s*[+,]\s*M\b/i.test(l));
    const superAltM = added.filter(l => /SUPER\s*[+,]\s*ALT\s*[+,]\s*M\b/i.test(l));
    expect(superM.some(l => l.includes("/machines") && !l.includes("mirai=1"))).toBe(true);
    expect(superAltM.some(l => l.includes("mirai=1"))).toBe(true);
  });

  test("only makes the window fully opaque: no fixed workspace, no floating", () => {
    const added = addedHyprLines(before, env.home).map(code);
    expect(added.some(l => /opaque|opacity/i.test(l))).toBe(true);
    expect(added.filter(l => /float|workspace/i.test(l))).toEqual([]);
  });

  test("puts the bar widget in the right section and leaves every other widget where it was", () => {
    const shell: { bar: { layout: Layout } } = JSON.parse(readFileSync(join(env.home, ".config/omarchy/shell.json"), "utf8"));
    const { left, center, right } = shell.bar.layout;
    expect(left).toEqual(DEFAULT_LAYOUT.left);
    expect(center).toEqual(DEFAULT_LAYOUT.center);
    const known = new Set(DEFAULT_LAYOUT.right.map(e => e.id));
    const added = right.filter(e => !known.has(e.id));
    expect(added).toHaveLength(1);
    expect(right.filter(e => known.has(e.id))).toEqual(DEFAULT_LAYOUT.right);
    const id = added[0]?.id ?? "";
    const manifest: { id: string; kinds: string[]; entryPoints: { barWidget: string } } = JSON.parse(readFileSync(join(env.home, ".config/omarchy/plugins", id, "manifest.json"), "utf8"));
    expect(manifest.id).toBe(id);
    expect(manifest.kinds).toContain("bar-widget");
    expect(existsSync(join(env.home, ".config/omarchy/plugins", id, manifest.entryPoints.barWidget))).toBe(true);
  });

  test("the bar widget ships its logic as fleet.mjs, and its QML imports that module", () => {
    const shell: { bar: { layout: Layout } } = JSON.parse(readFileSync(join(env.home, ".config/omarchy/shell.json"), "utf8"));
    const known = new Set(DEFAULT_LAYOUT.right.map(e => e.id));
    const id = shell.bar.layout.right.find(e => !known.has(e.id))?.id ?? "";
    const dir = join(env.home, ".config/omarchy/plugins", id);
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of existsSync(d) ? readdirSync(d) : []) {
        const path = join(d, name);
        if (lstatSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(dir);
    const source = readFileSync(join(FRONTEND, "deploy/desktop/fleet.mjs"));
    expect(files.filter(f => f.endsWith("/fleet.mjs")).some(f => readFileSync(f).equals(source))).toBe(true);
    const qml = files.filter(f => f.endsWith(".qml")).map(f => readFileSync(f, "utf8"));
    expect(qml.some(body => /^\s*import\s+"[^"]*fleet\.mjs"\s+as\s+\w+/m.test(body))).toBe(true);
  });

  test("adds a Mirai submenu to the Omarchy menu and keeps the user's own entries", () => {
    const { items, byLabel, goTo } = miraiMenu(env.home);
    for (const own of ["personal", "personal.notes"]) expect(items.map(i => i.id)).toContain(own);
    expect(byLabel("Open Mirai")?.action).toContain("/machines");
    expect(byLabel("Ask mirAI")?.action).toContain("mirai=1");
    expect(byLabel("Save copied URL to Content")?.action).toBeTruthy();
    const targets = goTo.map(i => `${i.label.toLowerCase()} ${i.action ?? ""}`);
    for (const module of ["machines", "projects", "tasks", "ship", "content", "notes", "stats"]) {
      expect({ module, found: targets.some(t => t.startsWith(module) && t.includes(`/${module}`)) }).toEqual({ module, found: true });
    }
  });

  test("is safe to re-run: a second install changes nothing", async () => {
    await install(env, "local");
    expect(snapshot(env.home)).toEqual(installed);
  });

  test("--remove undoes everything and leaves the user's own config exactly as it was", async () => {
    await install(env, "--remove", "local");
    expect(snapshot(env.home)).toEqual(before);
  });
});

describe("the bar position", () => {
  test("sits just left of the clock when the clock is in the right section", async () => {
    const env = makeEnv(CLOCK_RIGHT_LAYOUT);
    await install(env, "local");
    const shell: { bar: { layout: Layout } } = JSON.parse(readFileSync(join(env.home, ".config/omarchy/shell.json"), "utf8"));
    const ids = shell.bar.layout.right.map(e => e.id);
    const known = new Set(CLOCK_RIGHT_LAYOUT.right.map(e => e.id));
    const mirai = ids.findIndex(id => !known.has(id));
    expect(mirai).toBeGreaterThanOrEqual(0);
    expect(ids[mirai + 1]).toBe("omarchy.clock");
  });
});

describe("mirai-desktop-open", () => {
  const env = makeEnv();
  beforeAll(() => install(env, "local"));

  test("with no Desktop app open it launches one on the path, tagged with this machine, without asking the hub", async () => {
    setWindows(env, false);
    await runLauncher(env, "/tasks");
    const urls = await eventually(() => launchedUrls(env), u => u.length > 0);
    expect(urls.map(u => [u.pathname, u.searchParams.get("desktop")])).toEqual([["/tasks", MACHINE]]);
    expect(opens()).toEqual([]);
  });

  test("with a Desktop app open it asks the hub to open the path there and focuses that window", async () => {
    setWindows(env, true);
    hubState.delivered = 1;
    await runLauncher(env, "/ship");
    expect(opens().map(r => [r.method, r.contentType.startsWith("application/json"), r.body])).toEqual([["POST", true, { machine: MACHINE, path: "/ship" }]]);
    expect(await eventually(() => focusedMirai(env), Boolean)).toBe(true);
    await Bun.sleep(300);
    expect(launchedUrls(env)).toEqual([]);
  });

  test("when the hub delivered to no window it launches a new one instead", async () => {
    setWindows(env, true);
    hubState.delivered = 0;
    await runLauncher(env, "/notes");
    const urls = await eventually(() => launchedUrls(env), u => u.length > 0);
    expect(urls.map(u => [u.pathname, u.searchParams.get("desktop")])).toEqual([["/notes", MACHINE]]);
    hubState.delivered = 1;
  });

  test("a path with a query keeps it next to the machine tag", async () => {
    setWindows(env, false);
    await runLauncher(env, "/machines?mirai=1");
    const urls = await eventually(() => launchedUrls(env), u => u.length > 0);
    expect(urls.map(u => [u.pathname, u.searchParams.get("mirai"), u.searchParams.get("desktop")])).toEqual([["/machines", "1", MACHINE]]);
  });
});

describe("Save copied URL to Content", () => {
  const env = makeEnv();
  beforeAll(() => install(env, "local"));

  async function save(clipboard: string | null) {
    const action = miraiMenu(env.home).byLabel("Save copied URL to Content")?.action ?? "false";
    if (clipboard === null) rmSync(join(env.stubs, "clipboard"), { force: true });
    else write(join(env.stubs, "clipboard"), clipboard);
    env.clearCalls();
    hubState.requests = [];
    await run(env, ["bash", "-c", action], env.vars());
    return eventually(() => notifications(env), n => n.length > 0);
  }

  const saves = () => hubState.requests.filter(r => r.method === "POST" && typeof r.body === "object" && r.body !== null && "url" in r.body);

  test("an http(s) URL on the clipboard is saved to Content and confirmed", async () => {
    hubState.saveError = null;
    const shown = await save("https://example.com/post?id=1\n");
    expect(saves().map(r => [r.path, r.contentType.startsWith("application/json"), r.body])).toEqual([["/api/later", true, { url: "https://example.com/post?id=1" }]]);
    expect(shown.join("\n")).toContain("Saved to Content");
  });

  test("anything that is not an http(s) URL is refused before it reaches the hub", async () => {
    for (const clipboard of ["just some words", "javascript:alert(1)", "ftp://files.example/x", "file:///etc/passwd", null]) {
      const shown = await save(clipboard);
      expect({ clipboard, shown: shown.join("\n").includes("Clipboard has no URL") }).toEqual({ clipboard, shown: true });
      expect(saves()).toEqual([]);
    }
  });

  test("the hub's own error is what the notification says", async () => {
    hubState.saveError = "that link is already in Content";
    const shown = await save("https://example.com/again");
    expect(shown.join("\n")).toContain("that link is already in Content");
    hubState.saveError = null;
  });
});
