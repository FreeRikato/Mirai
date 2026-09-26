import type { TaskLink } from "@/shared/tasks";

const LINK = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|(?:\s+-\s+)?(https?:\/\/[^\s<>()[\]]+)/g;
const TRAILING = /[.,;:!?'"]+$/;
const REPO_REF = /(?<![\w/.])([\w.-]+\/[\w.-]+)#(\d+)\b/g;

export function classifyUrl(url: string): TaskLink {
  const u = URL.parse(url);
  if (!u) return { kind: "url", url, host: url };
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "linear.app" && parts[1] === "issue" && parts[2]) return { kind: "linear", url, id: parts[2] };
  if (host === "github.com" && parts.length >= 4) {
    const [owner, repo, kind, n] = parts;
    const number = Number(n);
    if (Number.isInteger(number) && (kind === "pull" || kind === "issues")) {
      return { kind: kind === "pull" ? "pr" : "issue", url, repo: `${owner}/${repo}`, number };
    }
  }
  if (host === "jam.dev" && parts[0] === "c" && parts[1]) return { kind: "jam", url, id: parts[1].split("-")[0] ?? parts[1] };
  return { kind: "url", url, host };
}

export function extractLinks(text: string): { title: string; links: TaskLink[] } {
  const urls: string[] = [];
  const add = (u: string) => {
    if (!urls.includes(u)) urls.push(u);
  };

  const title = text
    .replace(LINK, (_, label: string | undefined, mdUrl: string | undefined, bare: string | undefined) => {
      if (mdUrl !== undefined) {
        add(mdUrl);
        return label ?? "";
      }
      if (bare !== undefined) add(bare.replace(TRAILING, ""));
      return " ";
    })
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-:,;]+|[\s\-:,;(]+$/g, "")
    .trim();

  for (const [, repo, n] of text.matchAll(REPO_REF)) add(`https://github.com/${repo}/issues/${n}`);

  return { title: /[\p{L}\p{N}]/u.test(title) ? title : "", links: urls.map(classifyUrl) };
}

const CODE_OR_LINK = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s<>()]+)/;
const ISSUE_REF = /(?<![\w/.#-])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g;

export function linkRefs(markdown: string, repo: string): string {
  return markdown
    .split(CODE_OR_LINK)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(ISSUE_REF, (ref: string, other: string | undefined, n: string) => `[${ref}](https://github.com/${other ?? repo}/issues/${n})`)))
    .join("");
}
