import { expect, test } from "bun:test";
import { MetricsSchema } from "@/shared/schema";
import { systemThemeVars } from "./systemTheme";

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

test.each([
  { name: "missing", system: { mode: "dark" as const, colors: {} } },
  { name: "empty", system: { mode: "dark" as const, monoFont: "", colors: {} } },
])("accepts a $name monoFont and leaves Mirai's font variable untouched", ({ system }) => {
  const parsed = MetricsSchema.safeParse({ ...report, system });
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;

  expect(systemThemeVars(parsed.data.system!).hasOwnProperty("--font-mono")).toBe(false);
});
