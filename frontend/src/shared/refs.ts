import { classifyUrl } from "./links";
import type { ShipPr } from "./ship";
import type { GithubIssue, LinearIssue } from "./tasks";

export type Peek = { kind: "github"; repo: string; number: number } | { kind: "linear"; id: string };

export type GithubRef = { kind: "pr"; pr: ShipPr } | { kind: "issue"; issue: GithubIssue } | { kind: "unavailable"; reason: string };
export type LinearRef = { kind: "ready"; issue: LinearIssue } | { kind: "unavailable"; reason: string };

const GITHUB_PARAM = /^([\w.-]+\/[\w.-]+)\/(\d+)$/;
const LINEAR_PARAM = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

export function peekOf(url: string): Peek | null {
  const link = classifyUrl(url);
  if (link.kind === "pr" || link.kind === "issue") return { kind: "github", repo: link.repo, number: link.number };
  if (link.kind === "linear") return { kind: "linear", id: link.id };
  return null;
}

export const peekParam = (peek: Peek): string => (peek.kind === "github" ? `${peek.repo}/${peek.number}` : peek.id);

export function parsePeek(param: string | null): Peek | null {
  if (!param) return null;
  const github = GITHUB_PARAM.exec(param);
  if (github?.[1] && github[2]) return { kind: "github", repo: github[1], number: Number(github[2]) };
  return LINEAR_PARAM.test(param) ? { kind: "linear", id: param } : null;
}
