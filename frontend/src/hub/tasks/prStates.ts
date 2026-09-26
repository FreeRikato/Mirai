import { z } from "zod";
import type { PrState } from "@/shared/tasks";
import type { GithubApi } from "../githubApi";

export type PrRef = { repo: string; number: number };
export const prKey = (r: PrRef) => `${r.repo}#${r.number}`;

const PR_STATE = { OPEN: "open", CLOSED: "closed", MERGED: "merged" } as const satisfies Record<string, PrState>;
const PrSchema = z.object({ pullRequest: z.object({ state: z.enum(["OPEN", "CLOSED", "MERGED"]) }).nullable() }).nullable();

const CHUNK = 50;

export function createPrStates(call: GithubApi) {
  const final = new Map<string, PrState>();

  async function ask(refs: readonly PrRef[]): Promise<Map<string, PrState>> {
    const vars: Record<string, unknown> = {};
    const decl: string[] = [];
    const fields = refs.map((r, i) => {
      const [owner = "", name = ""] = r.repo.split("/");
      Object.assign(vars, { [`o${i}`]: owner, [`n${i}`]: name, [`p${i}`]: r.number });
      decl.push(`$o${i}: String!, $n${i}: String!, $p${i}: Int!`);
      return `r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $p${i}) { state } }`;
    });
    const data = z.record(z.string(), PrSchema).parse(await call(`query PrStates(${decl.join(", ")}) { ${fields.join("\n")} }`, vars));
    const out = new Map<string, PrState>();
    refs.forEach((r, i) => {
      const state = data[`r${i}`]?.pullRequest?.state;
      if (state) out.set(prKey(r), PR_STATE[state]);
    });
    return out;
  }

  return async (refs: readonly PrRef[]): Promise<Map<string, PrState>> => {
    const unique = [...new Map(refs.map(r => [prKey(r), r])).values()];
    const out = new Map<string, PrState>();
    const todo = unique.filter(r => {
      const known = final.get(prKey(r));
      if (known) out.set(prKey(r), known);
      return !known;
    });
    for (let i = 0; i < todo.length; i += CHUNK) {
      for (const [key, state] of await ask(todo.slice(i, i + CHUNK))) {
        out.set(key, state);
        if (state !== "open") final.set(key, state);
      }
    }
    return out;
  };
}

export type PrStates = ReturnType<typeof createPrStates>;
