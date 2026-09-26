const UNITS = ["B", "K", "M", "G", "T"] as const;

export function bytes(n: number): string {
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)}${UNITS[i]}`;
}

export const rate = (n: number): string => `${bytes(n)}/s`;

export const pct = (n: number): string => `${Math.round(n)}%`;

export function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

export function ago(iso: string | number | null, now = Date.now()): string {
  if (iso === null) return "--";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return "--";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function clock(at: number, now = Date.now()): string {
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }).toLowerCase();
}
