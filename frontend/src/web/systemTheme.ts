import type { Metrics } from "@/shared/schema";
import { useUi } from "./store";
export type SystemTheme = NonNullable<Metrics["system"]>;

const BUILT_IN = {
  bg: "#000000",
  fg: "#ffffff",
  link: "#7fa7ff",
  selection: "#ffffff",
  machine: ["#7fa7ff", "#e07bd8", "#4fc8b8", "#a8e06a", "#ff9e7a", "#b69cff", "#6fd3ff", "#f28db2"],
  mono: '"Martian Mono", ui-monospace, monospace',
} as const;

const STATUS = {
  dark: { ok: "#5fd08a", warn: "#f4b63f", bad: "#ff5a4e" },
  light: { ok: "#1f8a4c", warn: "#a86400", bad: "#c8302a" },
} as const;

const GREYS = {
  sunk: 2,
  hover: 3.1,
  drop: 2.9,
  popover: 3.9,
  raise: 5.5,
  lift: 7.8,
  track: 8.6,
  rule: 11.8,
  faint: 22.7,
  ring: 22.7,
} as const;

const MACHINE_KEYS = ["blue", "magenta", "cyan", "orange", "bright_blue", "bright_magenta", "bright_cyan", "brown"] as const;

const mix = (share: number) => `color-mix(in srgb, var(--color-fg) ${share}%, var(--color-bg))`;

export const SYSTEM_THEME_VARIABLES = [
  "--color-bg",
  "--color-fg",
  "--color-link",
  "--color-accent",
  "--color-selection",
  "--color-selection-text",
  "--color-active",
  "--color-focus",
  "--color-ok",
  "--color-warn",
  "--color-bad",
  "--color-dim",
  "--color-soft",
  "--color-sunk",
  "--color-hover",
  "--color-drop",
  "--color-popover",
  "--color-raise",
  "--color-lift",
  "--color-track",
  "--color-rule",
  "--color-faint",
  "--color-ring",
  "--font-mono",
  ...MACHINE_KEYS.map((_, i) => `--color-machine-${i + 1}`),
] as const;
const SYSTEM_THEME_ALIASES: Readonly<Record<string, string>> = {
  "--color-bg": "--mirai-bg",
  "--color-fg": "--mirai-fg",
  "--color-dim": "--mirai-dim",
  "--color-rule": "--mirai-rule",
  "--color-track": "--mirai-track",
  "--color-raise": "--mirai-raise",
  "--color-bad": "--mirai-bad",
  "--color-warn": "--mirai-warn",
  "--color-ok": "--mirai-ok",
  "--color-faint": "--mirai-faint",
  "--color-soft": "--mirai-soft",
  "--color-sunk": "--mirai-sunk",
  "--color-hover": "--mirai-hover",
  "--color-lift": "--mirai-lift",
  "--color-drop": "--mirai-drop",
  "--color-link": "--mirai-link",
  "--color-selection": "--mirai-selection",
  "--color-selection-text": "--mirai-selection-text",
  "--color-active": "--mirai-active",
  "--color-focus": "--mirai-focus",
  "--color-popover": "--mirai-popover",
  "--color-accent": "--mirai-accent",
  "--color-ring": "--mirai-ring",
  "--font-mono": "--mirai-font-mono",
};

export function systemThemeValue(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.setProperty(name.startsWith("--font-") ? "font-family" : "color", `var(${name})`);
  document.documentElement.append(probe);
  const property = name.startsWith("--font-") ? "font-family" : "color";
  const value = getComputedStyle(probe).getPropertyValue(property).trim();
  probe.remove();
  return value || fallback;
}

export function systemThemeVars(theme: SystemTheme): Record<string, string> {
  const colors = theme.colors;
  const pick = (key: string, fallback: string) => colors[key] ?? fallback;
  const status = STATUS[theme.mode];
  const fg = pick("foreground", BUILT_IN.fg);
  const vars: Record<string, string> = {
    "--color-bg": pick("background", BUILT_IN.bg),
    "--color-fg": fg,
    "--color-link": pick("accent", BUILT_IN.link),
    "--color-selection": pick("selection", mix(25)),
    "--color-selection-text": "var(--color-fg)",
    "--color-accent": "var(--color-selection)",
    "--color-active": "var(--color-link)",
    "--color-focus": "var(--color-link)",
    "--color-ok": status.ok,
    "--color-warn": status.warn,
    "--color-bad": status.bad,
    "--color-dim": mix(58),
    "--color-soft": mix(82),
  };
  const monoFont = theme.monoFont?.trim();
  if (monoFont) vars["--font-mono"] = `${JSON.stringify(monoFont)}, monospace`;
  for (const [name, share] of Object.entries(GREYS)) vars[`--color-${name}`] = mix(share);
  MACHINE_KEYS.forEach((key, i) => {
    vars[`--color-machine-${i + 1}`] = pick(key, BUILT_IN.machine[i] ?? BUILT_IN.machine[0]);
  });
  return vars;
}

export function desktopMachineForSearch(search: string): string | null {
  const fromUrl = new URLSearchParams(search).get("desktop")?.trim() || null;
  try {
    if (fromUrl) {
      sessionStorage.setItem("mirai.desktop.machine", fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem("mirai.desktop.machine");
  } catch {
    return fromUrl;
  }
}
/*
 * Fleet updates arrive every couple of seconds and carry the same theme almost
 * every time. Surfaces that read colors in JavaScript re-render on
 * themeVersion, so only a real change may bump it; the default look needs no
 * applying, which is why nothing counts as applied at first.
 */
let appliedKey = "";

export function applySystemTheme(theme: SystemTheme | undefined): void {
  const key = theme ? JSON.stringify(systemThemeVars(theme)) : "";
  if (key === appliedKey) return;
  appliedKey = key;
  const root = document.documentElement;
  for (const name of SYSTEM_THEME_VARIABLES) root.style.removeProperty(name);
  for (const name of Object.values(SYSTEM_THEME_ALIASES)) root.style.removeProperty(name);
  if (theme) {
    const vars = systemThemeVars(theme);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    for (const [name, alias] of Object.entries(SYSTEM_THEME_ALIASES)) {
      const value = vars[name];
      if (value !== undefined) root.style.setProperty(alias, value);
    }
    root.style.colorScheme = theme.mode;
  } else {
    root.style.colorScheme = "dark";
  }
  useUi.getState().bumpThemeVersion();
}
