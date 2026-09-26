import type { BunRequest } from "bun";
import { z } from "zod";
import { isPeriod } from "@/shared/usage";
import { readWrite } from "../http";
import { isTimeZone } from "./report";
import type { AiStats } from "./service";

export function createStatsRoutes(stats: AiStats) {
  return {
    "/api/stats/ai": async (req: BunRequest) => {
      const q = new URL(req.url).searchParams;
      const period = q.get("period") ?? "30d";
      const tz = q.get("tz") ?? "UTC";
      if (!isPeriod(period)) return Response.json({ error: "period must be 24h, 7d, 30d or 90d" }, { status: 400 });
      if (!isTimeZone(tz)) return Response.json({ error: `unknown time zone ${tz}` }, { status: 400 });
      const hidden = q.get("hide")?.split(",").filter(Boolean) ?? [];
      return Response.json(await stats.report({ period, tz, hidden }));
    },
    "/api/stats/ai/refresh": {
      POST: async (req: BunRequest) => {
        const r = await readWrite(req, z.object({}), "{}");
        if (!r.ok) return r.res;
        await stats.refresh();
        return Response.json({ ok: true });
      },
    },
  };
}
