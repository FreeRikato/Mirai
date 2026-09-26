import type { TailscaleStatus } from "@/shared/tailscale";

export const status: TailscaleStatus = {
  Version: "1.102.3-t9329c3677-ga522f65e9",
  MagicDNSSuffix: "tail0000.ts.net",
  Self: { ID: "self", DNSName: "macato.tail0000.ts.net.", HostName: "MacBook Air", OS: "macOS", Online: true, TailscaleIPs: ["100.64.0.10", "fd7a::1"] },
  Peer: {
    k1: { ID: "a", DNSName: "awsakato.tail0000.ts.net.", HostName: "awsakato", OS: "linux", Online: false, Relay: "blr", CurAddr: "", LastSeen: "2026-09-23T08:55:00Z", TailscaleIPs: ["100.94.12.30"] },
    k2: { ID: "i", DNSName: "phone.tail0000.ts.net.", HostName: "localhost", OS: "iOS", Online: true, TailscaleIPs: ["100.64.3.21"] },
    k3: { ID: "o", DNSName: "omarikato.tail0000.ts.net.", HostName: "omarikato", OS: "linux", Online: true, Relay: "blr", CurAddr: "192.168.200.105:41641", RxBytes: 40, TxBytes: 4, TailscaleIPs: ["100.64.26.46"] },
    k4: { ID: "r", DNSName: "archikato.tail0000.ts.net.", HostName: "archikato", OS: "linux", Online: true, Relay: "sin", CurAddr: "", TailscaleIPs: ["100.64.0.30"] },
  },
};
