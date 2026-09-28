const finite = value => (typeof value === "number" && Number.isFinite(value) ? value : null);

const diskPercent = disk => {
  const used = finite(disk?.used);
  const size = finite(disk?.size);
  return used === null || size === null || size <= 0 ? null : (used / size) * 100;
};

const fullestDisk = disks => {
  const values = (Array.isArray(disks) ? disks : []).map(diskPercent).filter(value => value !== null);
  return values.length ? Math.max(...values) : null;
};

const tone = (value, limit) => (value !== null && value >= limit ? "bad" : "ok");

const metricCell = (value, limit) => (value === null ? null : { value, tone: tone(value, limit) });

const rowFor = (machine, limits) => {
  const metrics = machine?.kind === "live" ? machine.metrics : null;
  const total = finite(metrics?.mem?.total);
  const used = finite(metrics?.mem?.used);
  const memory = total !== null && total > 0 && used !== null ? (used / total) * 100 : null;
  return {
    machine: machine?.ts?.name ?? "?",
    color: machine?.color ?? "",
    kind: machine?.kind ?? "offline",
    cpu: metricCell(finite(metrics?.cpu?.load), limits.loadHotPct),
    mem: metricCell(memory, limits.loadHotPct),
    temp: metricCell(finite(metrics?.temp?.cpu), limits.tempHotC),
    disk: metricCell(fullestDisk(metrics?.disks), limits.diskFullPct),
  };
};

const machineState = (machine, limits) => {
  if (!machine || machine.kind !== "live") return "warn";
  const metrics = machine.metrics;
  if ((metrics.failedServices ?? []).length) return "bad";
  if (finite(metrics.cpu?.load) >= limits.loadHotPct) return "bad";
  if (finite(metrics.temp?.cpu) >= limits.tempHotC) return "bad";
  if (fullestDisk(metrics.disks) >= limits.diskFullPct) return "bad";
  return "ok";
};

const worst = states => (states.includes("bad") ? "bad" : states.includes("warn") ? "warn" : "ok");

export function view(snapshot, limits) {
  if (!snapshot?.fleet) return { dot: "unreachable", label: "--", unreachable: true, rows: [], events: [] };
  const machines = Array.isArray(snapshot.fleet.machines) ? snapshot.fleet.machines : [];
  const online = machines.filter(machine => machine?.ts?.online).length;
  const waiting = finite(snapshot.badge?.waiting) ?? 0;
  const events = Array.isArray(snapshot.events)
    ? [...snapshot.events].sort((a, b) => (b?.at ?? b?.id ?? 0) - (a?.at ?? a?.id ?? 0)).slice(0, 3)
    : [];
  return {
    dot: worst(machines.map(machine => machineState(machine, limits))),
    label: `${online}/${machines.length} · ${waiting}`,
    unreachable: false,
    rows: machines.map(machine => rowFor(machine, limits)),
    events,
  };
}

export function notifications(lastSeenId, events) {
  if (!Array.isArray(events)) return { lastSeenId, notify: [] };
  const newest = events.reduce((max, event) => Math.max(max, Number(event?.id) || 0), lastSeenId ?? 0);
  if (lastSeenId === null || lastSeenId === undefined) return { lastSeenId: newest, notify: [] };
  const notify = [...events]
    .filter(event => (Number(event?.id) || 0) > lastSeenId && event?.severity === "bad")
    .sort((a, b) => (b?.id ?? 0) - (a?.id ?? 0))
    .map(event => ({
      urgency: "critical",
      machine: event.machine,
      title: "Mirai",
      body: event.message,
      command: ["mirai-desktop-open", `/machines/${encodeURIComponent(event.machine)}`],
    }));
  return { lastSeenId: newest, notify };
}
