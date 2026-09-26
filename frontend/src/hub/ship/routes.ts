import type { BunRequest } from "bun";
import { z } from "zod";
import { MarkViewedSchema, ReadinessItemSchema, RequestReviewSchema, shipBadge, SubmitReviewSchema } from "@/shared/ship";
import type { LinearSnapshot } from "@/shared/tasks";
import type { Config } from "../config";
import type { Db } from "../db";
import type { GithubApi, GithubRest } from "../githubApi";
import { readWrite, remoteWrite } from "../http";
import { createJev } from "../jev";
import { createRankingStore, RANKING_ROWS } from "../ranking";
import { createShip } from "./github";
import { createMergeReadiness } from "./readiness";

const idParam = (req: BunRequest) => new URL(req.url).searchParams.get("id") ?? "";

export type ShipDeps = {
  config: Config["ship"];
  limits: Config["tasks"]["remote"];
  ranking: Config["tasks"]["priority"];
  db: Db;
  github: GithubApi;
  rest: GithubRest;
  linear: () => Promise<LinearSnapshot>;
};

export function createShipRoutes(deps: ShipDeps) {
  const ship = createShip({ api: deps.github, rest: deps.rest, org: deps.config.org, limits: deps.limits, searchSize: deps.config.searchSize });
  const { jev, profile, batch, shown } = deps.ranking;
  const readiness = createMergeReadiness({
    jev: jev && createJev(jev),
    saved: createRankingStore(deps.db, RANKING_ROWS.mergeReadiness, ReadinessItemSchema),
    mine: () => ship.mine(),
    contexts: prs => ship.contexts(prs),
    linear: deps.linear,
    profile,
    batch,
    shown,
  });
  const missingId = () => Response.json({ error: "expected ?id=" }, { status: 400 });
  const routes = {
    "/api/ship": async () => Response.json(await ship.snapshot()),
    "/api/ship/badge": async () => Response.json(shipBadge(await ship.snapshot())),
    "/api/ship/search": async (req: BunRequest) => Response.json(await ship.search(new URL(req.url).searchParams.get("q") ?? "")),
    "/api/ship/body": async (req: BunRequest) => {
      const id = idParam(req);
      return id ? Response.json(await ship.body(id)) : missingId();
    },
    "/api/ship/readiness": async () => Response.json(await readiness.snapshot()),
    "/api/ship/readiness/refresh": {
      POST: async (req: Request) => {
        const r = await readWrite(req, z.object({}), "{}");
        return r.ok ? Response.json(await readiness.refresh()) : r.res;
      },
    },
    "/api/ship/request": {
      POST: async (req: Request) => {
        const r = await readWrite(req, RequestReviewSchema, "{ id }");
        return r.ok ? remoteWrite(() => ship.requestMe(r.body.id)) : r.res;
      },
    },
    "/api/ship/review": {
      GET: async (req: BunRequest) => {
        const id = idParam(req);
        return id ? Response.json(await ship.review(id)) : missingId();
      },
      POST: async (req: Request) => {
        const r = await readWrite(req, SubmitReviewSchema, "{ id, headSha, verdict, body, comments }");
        return r.ok ? remoteWrite(() => ship.submit(r.body)) : r.res;
      },
    },
    "/api/ship/viewed": {
      POST: async (req: Request) => {
        const r = await readWrite(req, MarkViewedSchema, "{ id, path, viewed }");
        return r.ok ? remoteWrite(() => ship.viewed(r.body)) : r.res;
      },
    },
  };
  return { routes, mine: () => ship.mine(), snapshot: () => ship.snapshot() };
}
