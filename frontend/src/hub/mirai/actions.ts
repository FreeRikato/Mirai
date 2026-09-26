import { homedir } from "node:os";

export type Action = { label: string; change: boolean };

const ALWAYS_READ = new Set(["basename", "cat", "cd", "column", "cut", "df", "diff", "dirname", "du", "echo", "free", "grep", "head", "jq", "ls", "nl", "printf", "ps", "pwd", "realpath", "stat", "tail", "test", "tr", "true", "uptime", "wc", "which", "whoami"]);

type FlagRule = { bare: RegExp; valued?: ReadonlySet<string> };

const FLAGS: Record<string, FlagRule> = {
  rg: { bare: /^-(?!-pre)/, valued: new Set(["-g", "-t", "-T", "-e", "-m", "-A", "-B", "-C", "--glob", "--type", "--max-count"]) },
  fd: { bare: /^(-[HIiLsgaFpd0-9e]+|--(hidden|no-ignore|type|extension|max-depth|glob|full-path|follow|absolute-path)(=\S+)?)$/, valued: new Set(["-t", "-e", "-d", "-E"]) },
  sort: { bare: /^-[nrufbhVMgRsz]+$/, valued: new Set(["-k", "-t"]) },
  uniq: { bare: /^-[cdiuz]+$/, valued: new Set(["-f", "-s", "-w"]) },
  date: { bare: /^-[uRI]+$|^--iso-8601(=\w+)?$/, valued: new Set(["-d", "--date"]) },
  curl: { bare: /^-[sSLfkINiv]+$|^--(silent|show-error|location|fail|insecure|head|compressed|no-buffer|include|verbose)$/, valued: new Set(["-m", "--max-time", "--connect-timeout", "-H", "--header", "-A", "--user-agent", "-u", "--user", "-w", "--write-out", "-o", "--output"]) },
  systemctl: { bare: /^--(user|no-pager|full|all)$|^-[al]+$/, valued: new Set(["-n", "--lines"]) },
  journalctl: { bare: /^-[fexrbkq]+$|^--(user|no-pager|reverse|follow|pager-end|catalog|boot|dmesg|quiet)$|^--(unit|lines|since|until|priority|grep|output|identifier)=\S+$/, valued: new Set(["-u", "-n", "--since", "--until", "-p", "-g", "-o", "-t", "--unit", "--lines", "--output", "--identifier"]) },
  sqlite3: { bare: /^-(readonly|json|header|noheader|column|csv|line|box|list|markdown|table|batch|bail)$/, valued: new Set(["-separator"]) },
  xargs: { bare: /^-[0r]+$|^-n\d+$/, valued: new Set(["-n", "-P"]) },
};

const SED_ADDRESS = String.raw`(?:\d+|\$|\/(?:[^/\\]|\\.)*\/)`;
const SED_COMMAND = String.raw`(?:p|d|q|=|s\/(?:[^/\\]|\\.)*\/(?:[^/\\]|\\.)*\/[gpI0-9]*)`;
const SED_SCRIPT = new RegExp(String.raw`^\s*(?:${SED_ADDRESS}(?:,${SED_ADDRESS})?\s*)?${SED_COMMAND}\s*(?:;\s*(?:${SED_ADDRESS}(?:,${SED_ADDRESS})?\s*)?${SED_COMMAND}\s*)*;?\s*$`);
const AWK_UNSAFE = /[>|]|system|getline|@include|@load|close|fflush/;
const SQL_UNSAFE = /writefile|vacuum|attach|load_extension|edit\s*\(|(^|[\n;])\s*\.(?!(tables|schema|indexes|headers|mode|width)\b)/i;
const GIT_READS = new Set(["status", "log", "diff", "show", "blame", "ls-files", "rev-parse"]);
const GIT_LISTS = new Set(["branch", "remote"]);
const GIT_LIST_FLAGS = new Set(["-v", "-vv", "-a", "-r", "--list", "--all", "--remotes"]);
const GIT_UNSAFE_FLAG = /^(-O|--open-files-in-pager|--output|--ext-diff|--textconv|-c$|--exec)/;
const SYSTEMCTL_READS = new Set(["status", "show", "list-units", "list-timers", "is-active", "is-failed", "cat"]);

type Parsed = { flags: string[]; values: string[]; positionals: string[] };

function parse(args: readonly string[], rule: FlagRule): Parsed | null {
  const out: Parsed = { flags: [], values: [], positionals: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!a.startsWith("-") || a === "-") out.positionals.push(a);
    else if (rule.valued?.has(a)) {
      out.flags.push(a);
      out.values.push(args[i + 1] ?? "");
      i++;
    } else if (rule.bare.test(a)) out.flags.push(a);
    else return null;
  }
  return out;
}

function curlReads(args: readonly string[]): boolean {
  const flagsRule = FLAGS.curl;
  if (!flagsRule) return false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    const value = args[i + 1] ?? "";
    if ((a === "-o" || a === "--output") && value !== "/dev/null") return false;
    if ((a === "-w" || a === "--write-out") && value.includes("%output")) return false;
    if (flagsRule.valued?.has(a)) i++;
  }
  return parse(args, flagsRule) !== null;
}

function sedReads(args: readonly string[]): boolean {
  const scripts: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "-e") {
      scripts.push(args[i + 1] ?? "");
      i++;
    } else if (/^-[nEr]+$/.test(a) || a === "--quiet") continue;
    else if (a.startsWith("-")) return false;
    else files.push(a);
  }
  if (scripts.length === 0) {
    const first = files.shift();
    if (first === undefined) return false;
    scripts.push(first);
  }
  return scripts.every(script => SED_SCRIPT.test(script));
}

function awkReads(args: readonly string[]): boolean {
  const programs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "-F" || a === "-v") i++;
    else if (/^-F.$/.test(a)) continue;
    else if (a.startsWith("-")) return false;
    else programs.push(a);
  }
  const program = programs[0];
  return program !== undefined && !AWK_UNSAFE.test(program);
}

function gitReads(args: readonly string[]): boolean {
  let rest = [...args];
  while (rest[0] === "--no-pager" || rest[0] === "-C") rest = rest[0] === "-C" ? rest.slice(2) : rest.slice(1);
  const [sub = "", ...more] = rest;
  if (more.some(a => GIT_UNSAFE_FLAG.test(a))) return false;
  if (GIT_READS.has(sub)) return true;
  return GIT_LISTS.has(sub) && more.every(a => GIT_LIST_FLAGS.has(a));
}

function readsWith(program: string, args: readonly string[], piped: boolean): boolean {
  if (ALWAYS_READ.has(program)) return true;
  const rule = FLAGS[program];
  switch (program) {
    case "sed":
      return sedReads(args);
    case "awk":
      return awkReads(args);
    case "curl":
      return curlReads(args);
    case "git":
      return gitReads(args);
    case "find":
      return !args.some(a => /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(a));
    case "tailscale":
      return ["status", "ip", "ping"].includes(args[0] ?? "") && args.slice(1).every(a => !a.startsWith("-") || /^-(-json|-peers|-self|-active|4|6|c=\d+)$/.test(a));
    case "xargs": {
      const cut = args.findIndex(a => !a.startsWith("-") && !/^\d+$/.test(a));
      const own = cut < 0 ? args : args.slice(0, cut);
      const [inner = "", ...innerArgs] = cut < 0 ? [] : args.slice(cut);
      return rule !== undefined && parse(own, rule) !== null && inner !== "" && readsWith(inner, innerArgs, false);
    }
    case "sqlite3": {
      const parsed = rule ? parse(args, rule) : null;
      return !piped && parsed !== null && parsed.flags.includes("-readonly") && !parsed.positionals.some(a => SQL_UNSAFE.test(a));
    }
    case "systemctl": {
      const parsed = rule ? parse(args, rule) : null;
      return parsed !== null && SYSTEMCTL_READS.has(parsed.positionals[0] ?? "");
    }
    case "uniq": {
      const parsed = rule ? parse(args, rule) : null;
      return parsed !== null && parsed.positionals.length <= 1;
    }
    case "date": {
      const parsed = rule ? parse(args, rule) : null;
      return parsed !== null && parsed.positionals.every(a => a.startsWith("+"));
    }
    default:
      return rule !== undefined && parse(args, rule) !== null;
  }
}

type Segment = { text: string; piped: boolean };

function segments(command: string): Segment[] {
  const out: Segment[] = [];
  let quote: string | null = null;
  let start = 0;
  let piped = false;
  const cut = (end: number, next: boolean) => {
    out.push({ text: command.slice(start, end), piped });
    piped = next;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "|" || c === "&" || c === ";" || c === "\n") {
      const doubled = command[i + 1] === c;
      cut(i, c === "|" && !doubled);
      if (doubled) i++;
      start = i + 1;
    }
  }
  cut(command.length, false);
  return out;
}

function tokens(segment: string): string[] {
  return (segment.match(/'[^']*'|"[^"]*"|[^\s'"]+(?:'[^']*'|"[^"]*"|[^\s'"]+)*/g) ?? []).map(t => t.replace(/'([^']*)'|"([^"]*)"/g, "$1$2"));
}

const QUOTED = /'[^']*'|"[^"]*"/g;
const HARMLESS_REDIRECT = /(?<=^|\s)(?:\d?>|&>)\s*\/dev\/null(?=\s|$|[;|&])|(?<=\s)2>&1(?=\s|$|[;|&])/g;
const RISKY_SYNTAX = /[<>#\\(){}`]|\$'|\$\(/;

export function isReadOnlyCommand(command: string): boolean {
  const plain = command.replace(HARMLESS_REDIRECT, " ");
  if (/\$'|`|\$\(|\\/.test(plain)) return false;
  if (RISKY_SYNTAX.test(plain.replace(QUOTED, "''"))) return false;
  return segments(plain).every(({ text, piped }) => {
    const [program = "", ...args] = tokens(text);
    return program === "" || (!program.includes("=") && readsWith(program, args, piped));
  });
}

const field = (args: unknown, key: string): string | undefined => {
  if (typeof args !== "object" || args === null) return undefined;
  const v: unknown = Reflect.get(args, key);
  return typeof v === "string" ? v : undefined;
};

const str = (args: unknown, key: string): string | undefined => field(args, key)?.trim() || undefined;

const lines = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

function unmatched(from: readonly string[], against: readonly string[]): number {
  const left = new Map<string, number>();
  for (const l of against) left.set(l, (left.get(l) ?? 0) + 1);
  let count = 0;
  for (const l of from) {
    const n = left.get(l) ?? 0;
    if (n > 0) left.set(l, n - 1);
    else count++;
  }
  return count;
}

function parsedEdits(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return undefined;
  }
}

function editsOf(args: unknown): unknown[] {
  const edits = parsedEdits(typeof args === "object" && args !== null ? Reflect.get(args, "edits") : undefined);
  if (Array.isArray(edits)) return edits;
  if (typeof edits === "object" && edits !== null) return [edits];
  return field(args, "oldText") !== undefined ? [args] : [];
}

function editDelta(args: unknown): string {
  const edits = editsOf(args);
  let added = 0;
  let removed = 0;
  for (const e of edits) {
    const before = lines(field(e, "oldText") ?? "");
    const after = lines(field(e, "newText") ?? "");
    added += unmatched(after, before);
    removed += unmatched(before, after);
  }
  return edits.length > 0 ? ` +${added} -${removed}` : "";
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function describeCall(tool: string, args: unknown, home: string = homedir()): Action {
  const path = () => {
    const p = str(args, "path") ?? ".";
    return p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
  };
  switch (tool) {
    case "bash": {
      const command = str(args, "command") ?? "";
      const homePath = new RegExp(`${escapeRegExp(home)}(?=[/\\s"':]|$)`, "g");
      return { label: `$ ${command.replace(homePath, "~")}`, change: !isReadOnlyCommand(command) };
    }
    case "read":
      return { label: `read ${path()}`, change: false };
    case "grep":
      return { label: `grep "${str(args, "pattern") ?? ""}" ${path()}`, change: false };
    case "find":
      return { label: `find "${str(args, "pattern") ?? ""}" ${path()}`, change: false };
    case "ls":
      return { label: `ls ${path()}`, change: false };
    case "write":
      return { label: `wrote ${path()} +${lines(field(args, "content") ?? "").length}`, change: true };
    case "edit":
      return { label: `edited ${path()}${editDelta(args)}`, change: true };
    case "machines":
      return { label: `read machines · ${str(args, "host") ?? "fleet"}`, change: false };
    case "tasks":
      return { label: `read tasks · ${str(args, "source") ?? "all"}`, change: false };
    case "ship":
      return { label: `read ship · ${str(args, "queue") ?? "pull requests"}`, change: false };
    case "stats":
      return { label: "read stats · 7d", change: false };
    case "content":
      return { label: "read content · queue", change: false };
    case "notes":
      return { label: `read notes · "${str(args, "query") ?? ""}"`, change: false };
    default:
      return { label: tool, change: true };
  }
}
