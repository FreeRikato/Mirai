import { SHIP_STATES, type ShipPr, type ShipState } from "@/shared/ship";

export type Tone = "ok" | "bad" | "warn" | "fg" | "dim" | "faint" | "link";

export type Group = { id: string; label: string; tone: Tone; prs: ShipPr[] };

export function matches(pr: ShipPr, text: string): boolean {
  const hay = `${pr.title} ${pr.repo} #${pr.number} ${pr.author} ${pr.head}`.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => hay.includes(word));
}

export function narrow(prs: readonly ShipPr[], f: { text: string; state: ShipState | null; hiddenRepos: readonly string[] }): ShipPr[] {
  return prs.filter(p => matches(p, f.text) && (f.state === null || p.state === f.state) && !f.hiddenRepos.includes(p.repo));
}

export function stateTone(pr: Pick<ShipPr, "state" | "checks" | "conflicts">): Tone {
  switch (pr.state) {
    case "ready":
      return "ok";
    case "blocked":
      return pr.checks.some(c => c.conclusion === "failed") || pr.conflicts ? "bad" : "warn";
    case "waiting":
      return "dim";
    case "draft":
      return "faint";
  }
}

export const STATE_LABEL: Record<ShipState, string> = { ready: "ready to ship", blocked: "blocked", waiting: "waiting on review", draft: "draft" };
export const STATE_TONE: Record<ShipState, Tone> = { ready: "ok", blocked: "bad", waiting: "dim", draft: "faint" };

export function groupMine(prs: readonly ShipPr[]): Group[] {
  return SHIP_STATES.map(state => ({ id: state, label: STATE_LABEL[state], tone: STATE_TONE[state], prs: prs.filter(p => p.state === state) })).filter(g => g.prs.length > 0);
}

export function groupReview(prs: readonly ShipPr[]): Group[] {
  const groups: Group[] = [
    { id: "rereview", label: "re-review", tone: "warn", prs: prs.filter(p => p.relation === "rereview") },
    { id: "requested", label: "requested", tone: "fg", prs: prs.filter(p => p.relation === "requested") },
  ];
  return groups.filter(g => g.prs.length > 0);
}

export function countBy<T>(xs: readonly T[], key: (x: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function checkSummary(pr: Pick<ShipPr, "checks">): { text: string; tone: Tone } {
  const ran = pr.checks.filter(c => c.conclusion !== "skipped");
  if (ran.length === 0) return { text: "–", tone: "dim" };
  const passed = ran.filter(c => c.conclusion === "passed").length;
  const tone = ran.some(c => c.conclusion === "failed") ? "bad" : passed === ran.length ? "ok" : "dim";
  return { text: `${passed}/${ran.length}`, tone };
}

export function reviewSummary(pr: Pick<ShipPr, "reviews" | "pending">): { text: string; tone: Tone } {
  const changes = pr.reviews.filter(r => r.state === "changes").length;
  if (changes) return { text: `${changes} ✗`, tone: "warn" };
  const approved = pr.reviews.filter(r => r.state === "approved").length;
  if (approved) return { text: `${approved} ✓`, tone: "ok" };
  return pr.pending.length ? { text: `0/${pr.pending.length}`, tone: "dim" } : { text: "–", tone: "dim" };
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
export const diffText = (pr: Pick<ShipPr, "additions" | "deletions">) => `+${compact(pr.additions)} −${compact(pr.deletions)}`;

export function step(ids: readonly string[], current: string | null, by: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return ids[0] ?? null;
  return ids[Math.min(ids.length - 1, Math.max(0, at + by))] ?? null;
}
