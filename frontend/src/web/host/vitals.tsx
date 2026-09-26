import { cn } from "cn";
import type { Metrics } from "@/shared/schema";
import { bytes, duration, pct, rate } from "../format";
import { Bar, Heading, Row } from "../ui";
import { useSettings } from "../settings";

export function Cores({ m, color }: { m: Metrics; color: string }) {
  const [l1, l5, l15] = m.cpu.loadAvg.map(v => v.toFixed(1));
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2">
      <Heading right={<span>load {l1}&nbsp; {l5}&nbsp; {l15}</span>}>cpu</Heading>
      <div className="flex h-[120px] items-end gap-1" aria-label="per-thread cpu">
        {m.cpu.cores.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end bg-track" title={`thread ${i}: ${pct(v)}`}>
            <div style={{ height: `${Math.max(1, v)}%`, background: v >= 90 ? "var(--color-bad)" : color }} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function Memory({ m, color }: { m: Metrics; color: string }) {
  const { total, used, cache, free, swapUsed } = m.mem;
  const parts = [
    { k: "used", v: used, fill: color, o: 1 },
    { k: "cache", v: cache, fill: "var(--color-fg)", o: 0.3 },
    { k: "free", v: free, fill: "var(--color-track)", o: 1 },
  ];
  return (
    <section className="flex w-full shrink-0 flex-col gap-2 @4xl:w-[380px]">
      <Heading right={<span>{bytes(used)} / {bytes(total)}</span>}>memory</Heading>
      <div className="flex h-[22px] gap-[2px]">
        {parts.map(p => (
          <div key={p.k} style={{ flexGrow: p.v, background: p.fill, opacity: p.o }} />
        ))}
      </div>
      <div className="flex flex-col gap-[5px]">
        {parts.map(p => (
          <Row key={p.k} label={p.k}>
            {bytes(p.v)}
          </Row>
        ))}
        <Row label="swap" tone={swapUsed > total / 2 ? "warn" : "fg"}>
          {bytes(swapUsed)}
        </Row>
      </div>
    </section>
  );
}

function Meter({ label, value, text, hotAt = Infinity }: { label: string; value: number; text: string; hotAt?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-20 shrink-0 truncate text-dim">{label}</span>
      <Bar value={value} hotAt={hotAt} />
      <span className={cn("w-[110px] shrink-0 text-right whitespace-nowrap", value >= hotAt && "text-bad")}>{text}</span>
    </div>
  );
}

export function Io({ m }: { m: Metrics }) {
  const rows = [
    ["net in", m.io.netIn],
    ["net out", m.io.netOut],
    ["disk read", m.io.diskRead],
    ["disk write", m.io.diskWrite],
  ] as const;
  const max = Math.max(1, ...rows.map(r => r[1]));
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2.5">
      <Heading>io</Heading>
      {rows.map(([k, v]) => (
        <Meter key={k} label={k} value={(v / max) * 100} text={rate(v)} />
      ))}
    </section>
  );
}

export function Disks({ m }: { m: Metrics }) {
  const { fleet: limits } = useSettings();
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2.5">
      <Heading>disks</Heading>
      {m.disks.map(d => (
        <Meter key={d.mount} label={d.mount} value={(d.used / d.size) * 100} text={`${bytes(d.used)} / ${bytes(d.size)}`} hotAt={limits.diskFullPct} />
      ))}
    </section>
  );
}

export function Health({ m }: { m: Metrics }) {
  const { fleet: limits } = useSettings();
  const b = m.battery;
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2.5">
      <Heading>health</Heading>
      {m.temp && (
        <Row label="cpu temp" tone={m.temp.cpu >= limits.tempHotC ? "bad" : "fg"}>
          {Math.round(m.temp.cpu)}°C
        </Row>
      )}
      {m.temp && m.temp.max > m.temp.cpu && <Row label="hottest core">{Math.round(m.temp.max)}°C</Row>}
      {b && (
        <Row label="battery">
          {b.percent}%&nbsp; {b.charging ? "charging" : b.onAc ? "on ac" : "on battery"}
        </Row>
      )}
      {b && b.healthPct !== null && (
        <Row label="battery health" tone={b.healthPct < 80 ? "warn" : "fg"}>
          {b.healthPct}%{b.cycles !== null && <>&nbsp; {b.cycles} cycles</>}
        </Row>
      )}
      <Row label="uptime">{duration(m.uptimeSec)}</Row>
      <Row label="agent">{m.info.agentVersion}</Row>
    </section>
  );
}
