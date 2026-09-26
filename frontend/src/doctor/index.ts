import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { resolveToken } from "@/hub/githubApi";
import { healthy, render, runDoctor } from "./checks";

const { values } = parseArgs({ options: { hub: { type: "string" } } });

const checks = await runDoctor({
  env: process.env,
  root: resolve(import.meta.dir, "../.."),
  hubUrl: values.hub,
  githubToken: () => resolveToken(process.env.GITHUB_TOKEN?.trim() || undefined),
});
console.log(render(checks));
process.exit(healthy(checks) ? 0 : 1);
