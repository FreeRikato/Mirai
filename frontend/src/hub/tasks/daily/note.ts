import type { LocalState, LocalTask } from "@/shared/tasks";
import { extractLinks } from "@/shared/links";

const TASK = /^(\s*)[-*+] \[(.)\] ?(.*)$/;
const BULLET = /^(\s*)[-*+] /;

const MARK: Record<LocalState, string> = { open: " ", doing: "/", done: "x", dropped: "-" };
const STATE_OF: Record<string, LocalState> = { " ": "open", "/": "doing", x: "done", X: "done", "-": "dropped" };
const CARRIED = ">";

type Line = { text: string; indent: number; task: { mark: string; body: string } | null; bullet: boolean };

const indentOf = (ws: string) => ws.replaceAll("\t", "    ").length;

function readLine(text: string): Line {
  const t = TASK.exec(text);
  if (t) return { text, indent: indentOf(t[1] ?? ""), task: { mark: t[2] ?? " ", body: t[3] ?? "" }, bullet: true };
  const b = BULLET.exec(text);
  return { text, indent: b ? indentOf(b[1] ?? "") : 0, task: null, bullet: b !== null };
}

function blockEnd(lines: readonly Line[], start: number): number {
  const head = lines[start];
  if (!head) return start;
  let i = start + 1;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l.text.trim() === "") break;
    const deeper = l.bullet && l.indent > head.indent;
    const note = l.bullet && !l.task && l.indent === head.indent;
    if (!deeper && !note) break;
  }
  return i;
}

export function parseNote(date: string, text: string): { tasks: LocalTask[]; counts: Record<LocalState, number> } {
  const lines = text.split("\n").map(readLine);
  const counts: Record<LocalState, number> = { open: 0, doing: 0, done: 0, dropped: 0 };
  for (const l of lines) {
    const state = l.task ? STATE_OF[l.task.mark] : undefined;
    if (state) counts[state]++;
  }

  const tasks: LocalTask[] = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    const state = l?.task ? STATE_OF[l.task.mark] : undefined;
    if (!l?.task) {
      i++;
      continue;
    }
    if (!state) {
      i = blockEnd(lines, i);
      continue;
    }
    const end = blockEnd(lines, i);
    const body = lines.slice(i + 1, end);
    const subs = body.filter(b => b.task && STATE_OF[b.task.mark]);
    const { title, links } = extractLinks(l.task.body);
    const noted = body.filter(b => !b.task).flatMap(b => extractLinks(b.text).links);
    tasks.push({
      id: `${date}:${i}`,
      date,
      line: i,
      state,
      title,
      raw: l.text,
      links: [...links, ...noted.filter(n => !links.some(x => x.url === n.url))],
      subtasks: { done: subs.filter(s => s.task && STATE_OF[s.task.mark] === "done").length, total: subs.length },
      block: lines
        .slice(i, end)
        .map(x => x.text)
        .join("\n"),
    });
    i = end;
  }
  return { tasks, counts };
}

export type Edit = { ok: true; text: string } | { ok: false };

const withMark = (line: string, mark: string) => line.replace(/\[.\]/, `[${mark}]`);

export function setState(text: string, line: number, raw: string, to: LocalState): Edit {
  const lines = text.split("\n");
  const current = lines[line];
  if (current !== raw || !TASK.test(current)) return { ok: false };
  lines[line] = withMark(current, MARK[to]);
  return { ok: true, text: lines.join("\n") };
}

export function replaceBlock(text: string, line: number, block: string, next: string): Edit {
  const lines = text.split("\n");
  const count = block.split("\n").length;
  if (lines.slice(line, line + count).join("\n") !== block) return { ok: false };
  lines.splice(line, count, ...next.split("\n"));
  return { ok: true, text: lines.join("\n") };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function carryOver(notes: readonly { date: string; text: string }[], today: string, carryDays: number): { today: string; updated: { date: string; text: string }[] } {
  const recent = notes.filter(n => n.date < today && daysBetween(n.date, today) <= carryDays).toSorted((a, b) => a.date.localeCompare(b.date));
  const carried: string[] = [];
  const updated: { date: string; text: string }[] = [];

  for (const note of recent) {
    const open = parseNote(note.date, note.text).tasks.filter(t => t.state === "open" || t.state === "doing");
    if (open.length === 0) continue;
    const lines = note.text.split("\n");
    for (const t of open) {
      carried.push(t.block);
      lines[t.line] = withMark(t.raw, CARRIED);
    }
    updated.push({ date: note.date, text: lines.join("\n") });
  }
  return { today: carried.join("\n"), updated };
}
