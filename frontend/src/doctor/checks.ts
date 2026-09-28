import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig, type Config } from "@/hub/config";
import { graphql, RemoteError } from "@/hub/remote";
import { ipv4Of, nameOf, readStatus } from "@/shared/tailscale";

export type Status = "ok" | "warn" | "fail" | "off";
export type Check = { readonly name: string; readonly status: Status; readonly detail: string };
export type Env = Readonly<Record<string, string | undefined>>;
export type DoctorInput = { readonly env: Env; readonly root: string; readonly hubUrl: string | undefined; readonly githubToken: () => Promise<string | null> };

const TIMEOUT_MS = 5_000;
const MIN_BUN = [1, 3] as const;

const check = (name: string, status: Status, detail: string): Check => ({ name, status, detail });

const tilde = (path: string): string => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);

const reason = (err: unknown): string => {
  if (err instanceof RemoteError) return err.message;
  if (err instanceof z.ZodError) return err.issues.map(i => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");
  if (err instanceof Error && err.name === "TimeoutError") return "timed out";
  if (err instanceof Error && "code" in err && typeof err.code === "string") return err.code;
  return "failed";
};

function bun(): Check {
  const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
  const fresh = major > MIN_BUN[0] || (major === MIN_BUN[0] && minor >= MIN_BUN[1]);
  return check("bun", fresh ? "ok" : "fail", fresh ? Bun.version : `${Bun.version} is too old, run: bun upgrade`);
}

function dependencies(root: string): Check {
  return existsSync(join(root, "node_modules", "react")) ? check("dependencies", "ok", "installed") : check("dependencies", "fail", "run: bun install");
}

async function envFile(root: string): Promise<Check> {
  const path = join(root, ".env");
  if (!existsSync(path)) return check(".env", "ok", "none, every setting uses its default");
  const ignored = await Bun.$`git check-ignore -q ${path}`.cwd(root).quiet().nothrow();
  if (ignored.exitCode === 1) return check(".env", "fail", "is not ignored by git, never commit it");
  const open = (statSync(path).mode & 0o077) !== 0;
  return open ? check(".env", "warn", "readable by other users, run: chmod 600 .env") : check(".env", "ok", "private and ignored by git");
}

type Self = { name: string; ip: string };

async function tailscale(bin: string): Promise<{ result: Check; self: Self | null }> {
  try {
    const status = await readStatus(bin);
    const ip = ipv4Of(status.Self);
    if (!ip) return { result: check("tailscale", "fail", "not connected, run: tailscale up"), self: null };
    const self = { name: nameOf(status.Self), ip };
    return { result: check("tailscale", "ok", `this machine is ${self.name}`), self };
  } catch {
    return { result: check("tailscale", "fail", `\`${bin} status\` failed, install Tailscale and run: tailscale up`), self: null };
  }
}

async function cargo(): Promise<Check> {
  const out = await Bun.$`cargo --version`.quiet().nothrow();
  return out.exitCode === 0 ? check("rust", "ok", out.stdout.toString().trim()) : check("rust", "warn", "cargo not found, needed to build the agent: https://rustup.rs");
}

function agentBinary(root: string): Check {
  const path = join(root, "bin", `mirai-agent-${process.platform}-${process.arch}`);
  return existsSync(path) ? check("agent build", "ok", tilde(path)) : check("agent build", "warn", "not built yet, run: bun run build:agent");
}

async function agent(self: Self | null, port: number): Promise<Check> {
  if (!self) return check("agent", "fail", "needs Tailscale first");
  try {
    const res = await fetch(`http://${self.ip}:${port}/metrics`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 403) return check("agent", "ok", `running on ${self.name}, answers only its hub`);
    return res.ok ? check("agent", "ok", `running on ${self.name}:${port}`) : check("agent", "fail", `answered ${res.status}`);
  } catch (err: unknown) {
    return check("agent", "fail", `not answering on ${self.name}:${port} (${reason(err)}), run: MIRAI_AGENT_HUB=<hub machine> deploy/install-agent.sh local`);
  }
}

const SystemSchema = z.object({
  mode: z.enum(["dark", "light"]),
  colors: z.record(z.string(), z.string()),
  monoFont: z.string(),
});

const FleetSchema = z.object({
  machines: z.array(z.object({
    kind: z.enum(["live", "no-agent", "offline"]),
    ts: z.object({ name: z.string() }),
    metrics: z.object({
      cpu: z.object({ load: z.number() }),
      system: SystemSchema.optional(),
    }).optional(),
  })),
});

const ShellEntrySchema = z.object({ id: z.string(), hub: z.string().url().optional() }).passthrough();
const ShellConfigSchema = z.object({
  bar: z.object({ layout: z.record(z.string(), z.array(z.unknown())) }),
}).passthrough();
const PluginManifestSchema = z.object({
  id: z.literal("mirai.fleet"),
  kinds: z.array(z.string()),
  entryPoints: z.object({ barWidget: z.string() }),
}).passthrough();

async function hub(url: string, self: Self | null): Promise<Check> {
  let fleet: z.infer<typeof FleetSchema>;
  try {
    const res = await fetch(`${url}/api/fleet`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return check("hub", "fail", `${url} answered ${res.status}`);
    fleet = FleetSchema.parse(await res.json());
  } catch (err: unknown) {
    return check("hub", "fail", `not answering at ${url} (${reason(err)}), start it with: deploy/install-hub.sh local`);
  }
  const live = fleet.machines.filter(m => m.kind === "live").length;
  const summary = `${fleet.machines.length} machine${fleet.machines.length === 1 ? "" : "s"} on the tailnet, ${live} reporting`;
  if (!self) return check("hub", "ok", summary);
  const me = fleet.machines.find(m => m.ts.name === self.name);
  if (!me) return check("hub", "warn", `${summary}, but not ${self.name} yet (discovery runs every 30 s)`);
  if (me.kind !== "live" || !me.metrics) return check("hub", "fail", `${summary}; ${self.name} is listed but its agent does not reach the hub, check MIRAI_AGENT_HUB`);
  return check("hub", "ok", `${summary}; ${self.name} at ${Math.round(me.metrics.cpu.load)}% cpu`);
}

class Unconfigured extends Error {}

const need = (value: string | null | undefined): string => {
  if (!value) throw new Unconfigured();
  return value;
};

async function signedIn(name: string, run: () => Promise<string>, off: string): Promise<Check> {
  try {
    return check(name, "ok", await run());
  } catch (err: unknown) {
    if (err instanceof Unconfigured) return check(name, "off", off);
    return check(name, "fail", `rejected: ${reason(err)}`);
  }
}

const GithubViewer = z.object({ viewer: z.object({ login: z.string() }) });
const LinearViewer = z.object({ viewer: z.object({ name: z.string() }) });

async function getJson(url: string, key: string): Promise<void> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new RemoteError(`${new URL(url).host} answered ${res.status}`);
}

function integrations(config: Config, input: DoctorInput): Promise<Check>[] {
  return [
    signedIn(
      "github",
      async () => {
        const data = await graphql(config.github.url, `bearer ${need(await input.githubToken())}`, TIMEOUT_MS, "{ viewer { login } }");
        return `signed in as ${GithubViewer.parse(data).viewer.login}`;
      },
      "no token: set GITHUB_TOKEN or run gh auth login (tasks and ship use it)",
    ),
    signedIn(
      "linear",
      async () => {
        const data = await graphql(config.tasks.linear.url, need(config.tasks.linear.apiKey), TIMEOUT_MS, "{ viewer { name } }");
        return `signed in as ${LinearViewer.parse(data).viewer.name}`;
      },
      "LINEAR_API_KEY not set (Linear board)",
    ),
    signedIn(
      "openrouter",
      async () => {
        const jev = config.tasks.priority.jev;
        await getJson(`${new URL(need(jev?.url)).origin}/api/v1/key`, need(jev?.apiKey));
        return "key accepted";
      },
      "OPENROUTER_API_KEY not set (priority ranking)",
    ),
    signedIn(
      "openai",
      async () => {
        await getJson("https://api.openai.com/v1/models", need(config.mirai.apiKey));
        return "key accepted";
      },
      "OPENAI_API_KEY not set (mirAI assistant)",
    ),
  ];
}

function vault(dir: string | undefined): Check {
  if (!dir) return check("vault", "off", "MIRAI_VAULT_DIR not set (daily-note tasks and notes)");
  if (!existsSync(join(dir, ".obsidian", "daily-notes.json"))) return check("vault", "fail", `${tilde(dir)} has no .obsidian/daily-notes.json, enable the Daily notes core plugin`);
  return check("vault", "ok", tilde(dir));
}

function desktopWebApp(home: string): Check {
  const path = join(home, ".local", "share", "applications", "mirai.desktop");
  if (!existsSync(path)) return check("desktop web app", "warn", "missing, run: deploy/install-desktop.sh local");
  try {
    const body = readFileSync(path, "utf8");
    if (/^Name=Mirai$/m.test(body) && /^Exec=.*mirai-desktop-open/m.test(body)) return check("desktop web app", "ok", tilde(path));
  } catch {
    // Report the same actionable failure as a missing entry.
  }
  return check("desktop web app", "warn", "invalid, run: deploy/install-desktop.sh local");
}

function desktopBindings(home: string): Check {
  const paths = [join(home, ".config", "hypr", "bindings.lua"), join(home, ".config", "hypr", "hyprland.lua")];
  const body = paths.filter(existsSync).map(path => readFileSync(path, "utf8")).join("\n");
  return body.includes("mirai-desktop-open") && /SUPER\s*\+\s*(ALT\s*\+\s*)?M/.test(body)
    ? check("desktop bindings", "ok", "SUPER+M and SUPER+ALT+M installed")
    : check("desktop bindings", "warn", "missing, run: deploy/install-desktop.sh local");
}

function desktopWidget(home: string): Check {
  const shell = join(home, ".config", "omarchy", "shell.json");
  const plugin = join(home, ".config", "omarchy", "plugins", "mirai.fleet");
  try {
    const config = ShellConfigSchema.parse(JSON.parse(readFileSync(shell, "utf8")));
    const entries = Object.values(config.bar.layout).flat();
    const placed = entries.some(entry => {
      const parsed = ShellEntrySchema.safeParse(entry);
      return parsed.success && parsed.data.id === "mirai.fleet" && typeof parsed.data.hub === "string";
    });
    const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8")));
    const files = manifest.entryPoints.barWidget === "Fleet.qml"
      && manifest.kinds.includes("bar-widget")
      && existsSync(join(plugin, manifest.entryPoints.barWidget))
      && existsSync(join(plugin, "fleet.mjs"));
    if (placed && manifest.id === "mirai.fleet" && files) {
      return check("desktop bar widget", "ok", "mirai.fleet installed");
    }
  } catch {
    // Fall through to the actionable installation check.
  }
  return check("desktop bar widget", "warn", "missing, run: install-desktop.sh local");
}

async function desktopTheme(url: string, self: Self | null): Promise<Check> {
  if (!self) return check("desktop System theme", "warn", "needs Tailscale first");
  try {
    const response = await fetch(`${url}/api/fleet`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return check("desktop System theme", "warn", `${url} answered ${response.status}`);
    const fleet = FleetSchema.parse(await response.json());
    const machine = fleet.machines.find(candidate => candidate.ts.name === self.name);
    const system = machine?.kind === "live" ? machine.metrics?.system : undefined;
    return system ? check("desktop System theme", "ok", "agent reports the System theme") : check("desktop System theme", "warn", "agent does not report the System theme");
  } catch (err: unknown) {
    return check("desktop System theme", "warn", `could not verify the System theme (${reason(err)})`);
  }
}

async function desktopChecks(input: DoctorInput, url: string, self: Self | null): Promise<Check[]> {
  const home = input.env.HOME?.trim() || homedir();
  if (!existsSync(join(home, ".config", "omarchy", "shell.json"))) return [];
  return [desktopWebApp(home), desktopBindings(home), desktopWidget(home), await desktopTheme(url, self)];
}
function tool(name: string, bin: string | undefined, off: string): Check {
  if (!bin) return check(name, "off", off);
  const found = existsSync(bin) ? bin : Bun.which(bin);
  return found ? check(name, "ok", tilde(found)) : check(name, "off", off);
}

export async function runDoctor(input: DoctorInput): Promise<Check[]> {
  const base = [bun(), dependencies(input.root), await envFile(input.root)];
  let config: Config;
  try {
    config = loadConfig({ ...input.env });
  } catch (err: unknown) {
    return [...base, check("settings", "fail", reason(err))];
  }
  const { result, self } = await tailscale(config.fleet.tailscaleBin);
  const hubUrl = (input.hubUrl ?? `http://127.0.0.1:${config.server.port}`).replace(/\/$/, "");
  const [rust, agentCheck, hubCheck, signins] = await Promise.all([cargo(), agent(self, config.fleet.agentPort), hub(hubUrl, self), Promise.all(integrations(config, input))]);
  const desktop = await desktopChecks(input, hubUrl, self);
  return [
    ...base,
    check("settings", "ok", "valid"),
    result,
    rust,
    agentBinary(input.root),
    agentCheck,
    hubCheck,
    ...signins,
    ...desktop,
    vault(config.tasks.vaultDir),
    check("ship", config.ship.org ? "ok" : "off", config.ship.org ? `org ${config.ship.org}` : "MIRAI_SHIP_ORG not set (pull request view)"),
    tool("yt-dlp", config.later.ytdlpBin, "not installed (saving YouTube playlists)"),
    tool("transcripts", config.later.asr.bin, "MIRAI_ASR_BIN not set (video transcripts, deploy/asr/setup.sh)"),
    tool("highlighter", config.code.bin, "not built (colours in PR review, deploy/build-code.sh)"),
  ];
}

const MARK: Record<Status, string> = { ok: "ok  ", warn: "warn", fail: "FAIL", off: "off " };

export function render(checks: readonly Check[]): string {
  const width = Math.max(...checks.map(c => c.name.length));
  const count = (s: Status) => checks.filter(c => c.status === s).length;
  const lines = checks.map(c => `  ${MARK[c.status]}  ${c.name.padEnd(width)}  ${c.detail}`);
  return ["mirai doctor", ...lines, "", `${count("ok")} ok, ${count("warn")} warn, ${count("fail")} fail, ${count("off")} off (optional, not set up)`].join("\n");
}

export const healthy = (checks: readonly Check[]): boolean => checks.every(c => c.status !== "fail");
