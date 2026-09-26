import { z } from "zod";
import type { LinearColumn, LinearIssue, LinearMove, LinearPriority, LinearSnapshot } from "@/shared/tasks";
import type { LinearRef } from "@/shared/refs";
import { classifyUrl, extractLinks } from "@/shared/links";
import { cached, graphql, paginate, RemoteError } from "../remote";

import type { RemoteLimits } from "../config";

const StateSchema = z.object({ id: z.string(), name: z.string(), type: z.string(), position: z.number() });
const PersonSchema = z.object({ name: z.string(), isMe: z.boolean() }).nullable();

const IssueNodeSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  priority: z.number(),
  updatedAt: z.string(),
  state: StateSchema,
  team: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  assignee: PersonSchema,
  creator: PersonSchema,
  cycle: z.object({ number: z.number(), endsAt: z.string() }).nullable(),
  attachments: z.object({ nodes: z.array(z.object({ url: z.string() })) }),
});

const PageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const IssuesSchema = z.object({ issues: z.object({ nodes: z.array(IssueNodeSchema), pageInfo: PageInfoSchema }) });
const TeamsSchema = z.object({ teams: z.object({ nodes: z.array(z.object({ id: z.string(), states: z.object({ nodes: z.array(StateSchema) }) })) }) });
const TeamStatesSchema = z.object({ issue: z.object({ team: z.object({ states: z.object({ nodes: z.array(StateSchema) }) }) }) });
const UpdateSchema = z.object({ issueUpdate: z.object({ success: z.boolean() }) });

const ISSUE_FIELDS = `
  id identifier title url description priority updatedAt
  state { id name type position }
  team { id key name }
  assignee { name isMe }
  creator { name isMe }
  cycle { number endsAt }
  attachments { nodes { url } }
`;

const ISSUES = `query Mine($after: String, $doneSince: DateTimeOrDuration!) {
  issues(first: 250, after: $after, orderBy: updatedAt, filter: {
    and: [
      { or: [{ assignee: { isMe: { eq: true } } }, { creator: { isMe: { eq: true } } }] }
      { canceledAt: { null: true } }
      { or: [{ completedAt: { null: true } }, { completedAt: { gt: $doneSince } }] }
    ]
  }) {
    nodes { ${ISSUE_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ONE = `query One($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} team { states { nodes { id name type position } } } } }`;
const OneSchema = z.object({ issue: IssueNodeSchema.extend({ team: IssueNodeSchema.shape.team.extend({ states: z.object({ nodes: z.array(StateSchema) }) }) }) });

const TEAMS = `query Teams { teams { nodes { id states { nodes { id name type position } } } } }`;

const TEAM_STATES = `query States($id: String!) { issue(id: $id) { team { states { nodes { id name type position } } } } }`;
const UPDATE = `mutation Move($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`;

type State = z.infer<typeof StateSchema>;

const PRIORITY: readonly LinearPriority[] = ["none", "urgent", "high", "medium", "low"];

export function columnOf(state: Pick<State, "id" | "type">, teamStates: readonly State[]): LinearColumn | null {
  switch (state.type) {
    case "triage":
    case "backlog":
    case "unstarted":
      return "todo";
    case "started": {
      const first = teamStates.filter(s => s.type === "started").toSorted((a, b) => a.position - b.position)[0];
      return !first || first.id === state.id ? "progress" : "review";
    }
    case "completed":
      return "done";
    default:
      return null;
  }
}

export function stateFor(states: readonly State[], column: LinearColumn): State | null {
  const fits = states.filter(s => columnOf(s, states) === column && !(column === "todo" && s.type === "triage"));
  const ranked = fits.toSorted((a, b) => Number(b.type === "unstarted") - Number(a.type === "unstarted") || a.position - b.position);
  return ranked[0] ?? null;
}

export function toIssue(n: z.infer<typeof IssueNodeSchema>, teamStates: readonly State[]): LinearIssue | null {
  const column = columnOf(n.state, teamStates);
  if (!column) return null;
  const described = extractLinks(n.description ?? "").links;
  const attached = n.attachments.nodes.map(a => classifyUrl(a.url));
  const links = [...attached, ...described].filter((l, i, all) => all.findIndex(x => x.url === l.url) === i && l.url !== n.url);
  return {
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    url: n.url,
    description: n.description ?? "",
    priority: PRIORITY[n.priority] ?? "none",
    column,
    stateName: n.state.name,
    team: n.team,
    assignee: n.assignee,
    creator: n.creator,
    cycle: n.cycle,
    links,
    updatedAt: n.updatedAt,
  };
}

export function createLinear({ apiKey, url, limits }: { apiKey: string | undefined; url: string; limits: RemoteLimits }) {
  const call = async (query: string, variables?: Record<string, unknown>) => {
    if (!apiKey) throw new RemoteError("set LINEAR_API_KEY on the hub");
    return graphql(url, apiKey, limits.timeoutMs, query, variables);
  };

  const issues = cached(async () => {
    const [nodes, teams] = await Promise.all([
      paginate(async after => IssuesSchema.parse(await call(ISSUES, { after, doneSince: `-P${limits.doneDays}D` })).issues, limits.maxPages),
      call(TEAMS).then(d => TeamsSchema.parse(d).teams.nodes),
    ]);
    const statesOf = new Map(teams.map(t => [t.id, t.states.nodes]));
    return nodes.flatMap(n => toIssue(n, statesOf.get(n.team.id) ?? []) ?? []);
  }, limits.cacheMs);

  return {
    async snapshot(): Promise<LinearSnapshot> {
      if (!apiKey) return { kind: "unavailable", reason: "set LINEAR_API_KEY on the hub to see Linear issues" };
      try {
        const { value, at } = await issues.get();
        return { kind: "ready", issues: value, fetchedAt: at };
      } catch (err: unknown) {
        return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
      }
    },

    async issue(identifier: string): Promise<LinearRef> {
      if (!apiKey) return { kind: "unavailable", reason: "set LINEAR_API_KEY on the hub to see Linear issues" };
      try {
        const node = OneSchema.parse(await call(ONE, { id: identifier })).issue;
        const { states, ...team } = node.team;
        const issue = toIssue({ ...node, team }, states.nodes);
        return issue ? { kind: "ready", issue } : { kind: "unavailable", reason: `${node.identifier} is ${node.state.name.toLowerCase()}` };
      } catch (err: unknown) {
        return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
      }
    },

    async move(m: LinearMove): Promise<{ ok: true } | { ok: false; error: string }> {
      const states = TeamStatesSchema.parse(await call(TEAM_STATES, { id: m.id })).issue.team.states.nodes;
      const target = stateFor(states, m.to);
      if (!target) return { ok: false, error: `this team has no ${m.to} state` };
      const out = UpdateSchema.parse(await call(UPDATE, { id: m.id, stateId: target.id }));
      issues.invalidate();
      return out.issueUpdate.success ? { ok: true } : { ok: false, error: "Linear refused the update" };
    },
  };
}

export type Linear = ReturnType<typeof createLinear>;
