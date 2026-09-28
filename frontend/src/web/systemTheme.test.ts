import { describe, expect, test } from "bun:test";
import { MetricsSchema, type Metrics } from "@/shared/schema";
import { systemThemeVars } from "./systemTheme";

type SystemTheme = NonNullable<Metrics["system"]>;

const TOKYO_NIGHT: SystemTheme = {
  mode: "dark",
  monoFont: "JetBrainsMono Nerd Font",
  colors: {
    accent: "#7aa2f7",
    selection: "#292e42",
    muted: "#565f89",
    background: "#1a1b26",
    foreground: "#A9B1D6",
    dark_foreground: "#565f89",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#ad8ee6",
    cyan: "#449dab",
    orange: "#eb927b",
    bright_blue: "#7da6ff",
    bright_magenta: "#bb9af7",
    bright_cyan: "#0db9d7",
    brown: "#75493d",
  },
};

const LATTE: SystemTheme = {
  mode: "light",
  monoFont: "Iosevka",
  colors: { accent: "#1e66f5", background: "#eff1f5", foreground: "#4c4f69", blue: "#1e66f5", green: "#40a02b", yellow: "#df8e1d", red: "#d20f39" },
};

const DARK_STATUS = { ok: "#5fd08a", warn: "#f4b63f", bad: "#ff5a4e" };
const LIGHT_STATUS = { ok: "#1f8a4c", warn: "#a86400", bad: "#c8302a" };
const BUILT_IN_MACHINES = ["#7fa7ff", "#e07bd8", "#4fc8b8", "#a8e06a", "#ff9e7a", "#b69cff", "#6fd3ff", "#f28db2"];

/*
 * Values may be written as plain hex, as var(--x) pointing at another entry of
 * the same map, or as CSS color-mix(). The helpers below resolve all three so
 * the tests pin the colors, not the spelling.
 */
type Rgb = readonly [number, number, number];

const lookup = (vars: Readonly<Record<string, string>>, name: string): string => {
  const value = vars[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value.trim();
};

const deref = (vars: Readonly<Record<string, string>>, value: string, depth = 0): string => {
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
  if (!ref?.[1] || depth > 8) return value.trim();
  return deref(vars, lookup(vars, ref[1]), depth + 1);
};

const hexRgb = (hex: string): Rgb | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const splitTopLevel = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
};

type Mix = { readonly a: string; readonly b: string; readonly shareA: number };

const parseMix = (vars: Readonly<Record<string, string>>, value: string): Mix | null => {
  const m = /^color-mix\((.*)\)$/s.exec(value.trim());
  if (!m?.[1]) return null;
  const [, first = "", second = ""] = splitTopLevel(m[1]);
  const part = (p: string) => {
    const pct = /\s+(\d+(?:\.\d+)?)%$/.exec(p);
    return { color: deref(vars, pct ? p.slice(0, pct.index) : p).toLowerCase(), pct: pct?.[1] === undefined ? null : Number(pct[1]) };
  };
  const a = part(first);
  const b = part(second);
  const pa = a.pct ?? (b.pct === null ? 50 : 100 - b.pct);
  const pb = b.pct ?? 100 - pa;
  return { a: a.color, b: b.color, shareA: (pa / (pa + pb)) * 100 };
};

/* How much of fg is mixed into bg, in percent, whether written as color-mix or as a precomputed hex. */
const fgShare = (vars: Readonly<Record<string, string>>, name: string, fg: string, bg: string): number => {
  const value = deref(vars, lookup(vars, name));
  const mix = parseMix(vars, value);
  if (mix) {
    if (mix.a === fg && mix.b === bg) return mix.shareA;
    if (mix.a === bg && mix.b === fg) return 100 - mix.shareA;
    throw new Error(`${name} mixes ${mix.a} and ${mix.b}, not the theme's fg ${fg} and bg ${bg}`);
  }
  const v = hexRgb(value);
  const f = hexRgb(fg);
  const b = hexRgb(bg);
  if (!v || !f || !b) throw new Error(`${name} = ${value} is neither a color-mix nor a hex color`);
  const d = f.map((c, i) => c - (b[i] ?? 0));
  const len2 = d.reduce((s, c) => s + c * c, 0);
  const t = v.reduce((s, c, i) => s + (c - (b[i] ?? 0)) * (d[i] ?? 0), 0) / len2;
  const off = Math.max(...v.map((c, i) => Math.abs(c - ((b[i] ?? 0) + t * (d[i] ?? 0)))));
  if (off > 6) throw new Error(`${name} = ${value} is not on the line from bg ${bg} to fg ${fg}`);
  return t * 100;
};

const color = (vars: Readonly<Record<string, string>>, name: string): string => deref(vars, lookup(vars, name)).toLowerCase();

const firstFamily = (stack: string): string => (splitTopLevel(stack)[0] ?? "").replace(/^["']|["']$/g, "");

/*
 * The share of white in each of today's greys on black: #1e1e1e is 30/255 of
 * the way from bg to fg, and so on. A System theme keeps those ratios.
 */
const GREYS: readonly (readonly [string, number])[] = [
  ["--color-sunk", 2.0],
  ["--color-hover", 3.1],
  ["--color-drop", 2.9],
  ["--color-popover", 3.9],
  ["--color-raise", 5.5],
  ["--color-lift", 7.8],
  ["--color-track", 8.6],
  ["--color-rule", 11.8],
  ["--color-faint", 22.7],
];

describe("a dark System theme", () => {
  const vars = systemThemeVars(TOKYO_NIGHT);
  const fg = "#a9b1d6";
  const bg = "#1a1b26";

  test("background, text and links come from the theme's background, foreground and accent", () => {
    expect(color(vars, "--color-bg")).toBe(bg);
    expect(color(vars, "--color-fg")).toBe(fg);
    expect(color(vars, "--color-link")).toBe("#7aa2f7");
  });

  test("dim and soft text are fg mixed into bg at about 58% and 82%, not the theme's faint muted greys", () => {
    expect(Math.abs(fgShare(vars, "--color-dim", fg, bg) - 58)).toBeLessThanOrEqual(5);
    expect(Math.abs(fgShare(vars, "--color-soft", fg, bg) - 82)).toBeLessThanOrEqual(5);
    expect(color(vars, "--color-dim")).not.toBe("#565f89");
  });

  test("every grey is fg mixed into bg at the ratio today's hex implies, so no grey is tinted by the accent", () => {
    for (const [name, share] of GREYS) {
      const got = fgShare(vars, name, fg, bg);
      expect({ name, off: Math.abs(got - share) <= 4 }).toEqual({ name, off: true });
    }
  });

  test("status colors stay Mirai's own even though the theme defines red, green and yellow", () => {
    expect(color(vars, "--color-ok")).toBe(DARK_STATUS.ok);
    expect(color(vars, "--color-warn")).toBe(DARK_STATUS.warn);
    expect(color(vars, "--color-bad")).toBe(DARK_STATUS.bad);
  });

  test("machine colors 1 to 8 come from blue, magenta, cyan, orange, bright_blue, bright_magenta, bright_cyan and brown", () => {
    const want = ["#7aa2f7", "#ad8ee6", "#449dab", "#eb927b", "#7da6ff", "#bb9af7", "#0db9d7", "#75493d"];
    expect(want.map((_, i) => color(vars, `--color-machine-${i + 1}`))).toEqual(want);
  });

  test("the mono font becomes the system monospace font while Doto, Inter and Source Serif are left alone", () => {
    const mono = lookup(vars, "--font-mono");
    expect(firstFamily(mono)).toBe("JetBrainsMono Nerd Font");
    expect(mono).toContain("monospace");
    for (const untouched of ["--font-dot", "--font-key", "--font-serif"]) expect(vars[untouched]).toBeUndefined();
  });
});

describe("a light System theme", () => {
  const vars = systemThemeVars(LATTE);

  test("takes the theme's light background and dark text", () => {
    expect(color(vars, "--color-bg")).toBe("#eff1f5");
    expect(color(vars, "--color-fg")).toBe("#4c4f69");
    expect(color(vars, "--color-link")).toBe("#1e66f5");
    expect(Math.abs(fgShare(vars, "--color-dim", "#4c4f69", "#eff1f5") - 58)).toBeLessThanOrEqual(5);
  });

  test("switches status colors to the fixed darker set", () => {
    expect(color(vars, "--color-ok")).toBe(LIGHT_STATUS.ok);
    expect(color(vars, "--color-warn")).toBe(LIGHT_STATUS.warn);
    expect(color(vars, "--color-bad")).toBe(LIGHT_STATUS.bad);
  });

  test("uses its own monospace font", () => {
    expect(firstFamily(lookup(vars, "--font-mono"))).toBe("Iosevka");
  });
});

describe("a System theme with missing keys", () => {
  test("each missing machine color falls back to today's value while present ones still apply", () => {
    const vars = systemThemeVars(LATTE);
    expect(color(vars, "--color-machine-1")).toBe("#1e66f5");
    expect([2, 3, 4, 5, 6, 7, 8].map(i => color(vars, `--color-machine-${i}`))).toEqual(BUILT_IN_MACHINES.slice(1));
  });

  test("a theme with no colors at all still yields a complete, valid palette", () => {
    const vars = systemThemeVars({ mode: "dark", monoFont: "JetBrainsMono Nerd Font", colors: {} });
    expect(BUILT_IN_MACHINES.map((_, i) => color(vars, `--color-machine-${i + 1}`))).toEqual(BUILT_IN_MACHINES);
    expect(color(vars, "--color-ok")).toBe(DARK_STATUS.ok);
    for (const name of ["--color-bg", "--color-fg", "--color-link"]) expect(hexRgb(color(vars, name))).not.toBeNull();
  });
});

describe("the agent report", () => {
  const report = {
    at: 1,
    info: { os: "Arch Linux", kernel: "7.2", cpuModel: "Intel i7", threads: 2, memTotal: 16e9, agentVersion: "0.8.0", tailscaleVersion: "1.102.3" },
    uptimeSec: 1,
    cpu: { load: 1, cores: [1, 1], loadAvg: [1, 1, 1] },
    mem: { total: 16e9, used: 8e9, cache: 4e9, free: 4e9, swapUsed: 0 },
    disks: [],
    io: { netIn: 0, netOut: 0, diskRead: 0, diskWrite: 0 },
    temp: null,
    battery: null,
    topProcs: [],
    failedServices: [],
  };

  test("carries an optional System theme with dark or light mode, the colors.toml keys and the mono font", () => {
    expect(MetricsSchema.parse({ ...report, system: TOKYO_NIGHT }).system).toEqual(TOKYO_NIGHT);
    expect(MetricsSchema.parse(report).system).toBeUndefined();
    expect(MetricsSchema.safeParse({ ...report, system: { ...LATTE, mode: "sepia" } }).success).toBe(false);
  });
});
