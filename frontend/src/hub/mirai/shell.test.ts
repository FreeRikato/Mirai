import { expect, test } from "bun:test";
import { withoutSecrets } from "./shell";

test("mirAI's shell keeps ordinary settings and drops anything named like a credential", () => {
  const env = { PATH: "/usr/bin", HOME: "/home/a", MIRAI_VAULT_DIR: "/v", LINEAR_API_KEY: "k", GITHUB_TOKEN: "t", MIRAI_REDDIT_SESSION: "s", DATABASE_URL: "u", GH_PAT: "p", DB_PASSWD: "p", XAUTHORITY: "x" };
  expect(Object.keys(withoutSecrets(env))).toEqual(["PATH", "HOME", "MIRAI_VAULT_DIR"]);
});
