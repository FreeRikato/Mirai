import { z } from "zod";
import type { NotesSnapshot } from "./notes";
import type { LocalSnapshot } from "./tasks";

export const DiskSchema = z.object({
  mount: z.string(),
  used: z.number(),
  size: z.number(),
});

export const MetricsSchema = z.object({
  at: z.number(),
  info: z.object({
    os: z.string(),
    kernel: z.string(),
    cpuModel: z.string(),
    threads: z.number(),
    memTotal: z.number(),
    agentVersion: z.string(),
    tailscaleVersion: z.string(),
  }),
  uptimeSec: z.number(),
  cpu: z.object({
    load: z.number(),
    cores: z.array(z.number()),
    loadAvg: z.tuple([z.number(), z.number(), z.number()]),
  }),
  mem: z.object({
    total: z.number(),
    used: z.number(),
    cache: z.number(),
    free: z.number(),
    swapUsed: z.number(),
  }),
  disks: z.array(DiskSchema),
  io: z.object({
    netIn: z.number(),
    netOut: z.number(),
    diskRead: z.number(),
    diskWrite: z.number(),
  }),
  temp: z.object({ cpu: z.number(), max: z.number() }).nullable(),
  battery: z
    .object({
      percent: z.number(),
      charging: z.boolean(),
      onAc: z.boolean(),
      cycles: z.number().nullable(),
      healthPct: z.number().nullable(),
    })
    .nullable(),
  topProcs: z.array(z.object({ name: z.string(), cpu: z.number() })),
  failedServices: z.array(z.string()),
});

export const ProcessSchema = z.object({
  pid: z.number(),
  name: z.string(),
  command: z.string(),
  user: z.string(),
  cpu: z.number(),
  memBytes: z.number(),
  started: z.string(),
  killable: z.boolean().optional(),
});

export const PortSchema = z.object({
  port: z.number(),
  proto: z.string(),
  bind: z.string(),
  pid: z.number().nullable(),
  process: z.string(),
});

export const ServiceStateSchema = z.enum(["running", "failed", "restarting", "stopped"]);

export const ServiceSchema = z.object({
  name: z.string(),
  kind: z.enum(["systemd", "launchd", "docker"]),
  state: ServiceStateSchema,
  detail: z.string(),
  since: z.string().nullable(),
  restarts: z.number().nullable(),
  ports: z.string(),
});

export const HostDetailSchema = z.object({
  at: z.number(),
  processes: z.array(ProcessSchema),
  ports: z.array(PortSchema),
  services: z.array(ServiceSchema),
});

export const KillSignalSchema = z.enum(["SIGTERM", "SIGKILL"]);

export const KillRequestSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string().min(1),
  signal: KillSignalSchema,
});

export const PingSchema = z.object({
  peer: z.string(),
  via: z.enum(["direct", "relay"]),
  region: z.string().nullable(),
  ms: z.number(),
});

export const AgentTailnetSchema = z.object({
  at: z.number(),
  pings: z.array(PingSchema),
});

export type Disk = z.infer<typeof DiskSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type Process = z.infer<typeof ProcessSchema>;
export type Port = z.infer<typeof PortSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceState = z.infer<typeof ServiceStateSchema>;
export type HostDetail = z.infer<typeof HostDetailSchema>;
export type KillSignal = z.infer<typeof KillSignalSchema>;
export type KillRequest = z.infer<typeof KillRequestSchema>;
export type Ping = z.infer<typeof PingSchema>;
export type AgentTailnet = z.infer<typeof AgentTailnetSchema>;

export type TailnetInfo = {
  id: string;
  name: string;
  os: string;
  ip: string;
  version: string;
  online: boolean;
  isSelf: boolean;
  path: Path;
  rxBytes: number;
  txBytes: number;
  lastSeen: string | null;
};

export type Path =
  | { kind: "self" }
  | { kind: "direct"; addr: string }
  | { kind: "relay"; region: string }
  | { kind: "none" };

export type Machine =
  | { kind: "live"; color: string; ts: TailnetInfo; metrics: Metrics }
  | { kind: "no-agent"; color: string; ts: TailnetInfo }
  | { kind: "offline"; color: string; ts: TailnetInfo };

export type Edge = {
  a: string;
  b: string;
  via: "direct" | "relay";
  region: string | null;
  ms: number | null;
};

export type Severity = "bad" | "warn" | "info";

export type FleetEvent = {
  id: number;
  at: number;
  machine: string;
  severity: Severity;
  message: string;
};

export type Fleet = {
  at: number;
  tailnet: string;
  machines: Machine[];
  edges: Edge[];
  latestVersion: string | null;
};

export type LoadRange = "1h" | "24h" | "7d";

export type LoadStrip = {
  range: LoadRange;
  buckets: number;
  rows: { machine: string; values: (number | null)[] }[];
};

export type ServerMessage =
  | { type: "fleet"; fleet: Fleet }
  | { type: "events"; events: FleetEvent[] }
  | { type: "host"; name: string; detail: HostDetail }
  | { type: "host-error"; name: string; error: string; at: number }
  | { type: "tasks-local"; snapshot: LocalSnapshot }
  | { type: "notes"; snapshot: NotesSnapshot };

export const ClientMessageSchema = z.object({ type: z.literal("watch"), fleet: z.boolean(), host: z.string().nullable() });
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
