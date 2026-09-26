import { z } from "zod";

const NodeSchema = z.object({
  ID: z.string(),
  DNSName: z.string(),
  HostName: z.string(),
  OS: z.string(),
  Online: z.boolean().optional(),
  TailscaleIPs: z.array(z.string()).nullable().optional(),
  CurAddr: z.string().optional(),
  Relay: z.string().optional(),
  RxBytes: z.number().optional(),
  TxBytes: z.number().optional(),
  LastSeen: z.string().optional(),
});

export const StatusSchema = z.object({
  Version: z.string(),
  MagicDNSSuffix: z.string().optional(),
  CurrentTailnet: z.object({ Name: z.string() }).nullable().optional(),
  Self: NodeSchema,
  Peer: z.record(z.string(), NodeSchema).nullable().optional(),
});

export type TailscaleNode = z.infer<typeof NodeSchema>;
export type TailscaleStatus = z.infer<typeof StatusSchema>;

const DESKTOP_OS = new Set(["macOS", "linux", "windows"]);

export function isPC(node: TailscaleNode): boolean {
  return DESKTOP_OS.has(node.OS);
}

export function nameOf(node: TailscaleNode): string {
  const label = node.DNSName.split(".")[0];
  return label && label.length > 0 ? label : node.HostName;
}

export function ipv4Of(node: TailscaleNode): string {
  return node.TailscaleIPs?.find(ip => ip.includes(".")) ?? "";
}

export function parseStatus(raw: string): TailscaleStatus {
  return StatusSchema.parse(JSON.parse(raw));
}

export async function readStatus(bin: string): Promise<TailscaleStatus> {
  const out = await Bun.$`${bin} status --json`.quiet().text();
  return parseStatus(out);
}
