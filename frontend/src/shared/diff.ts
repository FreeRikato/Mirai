export type DiffLine =
  | { kind: "context"; old: number; new: number; text: string }
  | { kind: "del"; old: number; new: null; text: string }
  | { kind: "add"; old: null; new: number; text: string };

export type Hunk = { header: string; lines: DiffLine[] };

export type Side = "LEFT" | "RIGHT";
export type Anchor = { side: Side; line: number };

export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let old = 0;
  let next = 0;
  for (const raw of patch.split("\n")) {
    const header = HEADER.exec(raw);
    if (header) {
      old = Number(header[1]);
      next = Number(header[2]);
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || raw.startsWith("\\")) continue;
    const text = raw.slice(1);
    if (raw.startsWith("-")) current.lines.push({ kind: "del", old: old++, new: null, text });
    else if (raw.startsWith("+")) current.lines.push({ kind: "add", old: null, new: next++, text });
    else current.lines.push({ kind: "context", old: old++, new: next++, text });
  }
  return hunks;
}

export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const line of lines) {
    if (line.kind === "del") {
      if (adds.length) flush();
      dels.push(line);
    } else if (line.kind === "add") adds.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

export const anchorOf = (line: DiffLine): Anchor => (line.kind === "del" ? { side: "LEFT", line: line.old } : { side: "RIGHT", line: line.new });

export const sameAnchor = (a: Anchor, b: Anchor): boolean => a.side === b.side && a.line === b.line;
