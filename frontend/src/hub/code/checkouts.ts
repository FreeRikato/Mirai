import { mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export class GitError extends Error {}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

type Deps = { dir: string; gitUrl: string; token: () => Promise<string> };

export function createCheckouts({ dir, gitUrl, token }: Deps) {
  const base = resolve(dir);
  const slug = (repo: string) => repo.replace("/", "__");
  const mirrorDir = (repo: string) => join(base, "mirrors", `${slug(repo)}.git`);
  const inFlight = new Map<string, Promise<unknown>>();
  const mergeBases = new Map<string, string>();

  const shared = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const running = inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = run().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };

  const gitEnv = async (): Promise<Record<string, string>> => ({
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${btoa(`x-access-token:${await token()}`)}`,
  });

  const run = async (cwd: string, args: readonly string[]): Promise<{ code: number; out: string; err: string }> => {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...(await gitEnv()) } });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err };
  };

  const git = async (cwd: string, args: readonly string[]): Promise<string> => {
    const r = await run(cwd, args);
    if (r.code !== 0) throw new GitError(`git ${args[0]} failed: ${r.err.trim().split("\n").at(-1) ?? `exit ${r.code}`}`);
    return r.out;
  };

  const mirror = (repo: string): Promise<string> =>
    shared(`mirror:${repo}`, async () => {
      const path = mirrorDir(repo);
      if (await exists(join(path, "HEAD"))) return path;
      await mkdir(join(base, "mirrors"), { recursive: true });
      try {
        await git(base, ["clone", "--bare", "--filter=blob:none", "--quiet", `${gitUrl}/${repo}.git`, path]);
      } catch (err: unknown) {
        await rm(path, { recursive: true, force: true });
        throw err;
      }
      return path;
    });

  const ensure = async (repo: string, shas: readonly string[]): Promise<string> => {
    const path = await mirror(repo);
    const known = await Promise.all(shas.map(async sha => (await run(path, ["cat-file", "-e", `${sha}^{commit}`])).code === 0));
    const missing = shas.filter((_, i) => !known[i]);
    if (missing.length) await shared(`fetch:${repo}:${missing.join(",")}`, () => git(path, ["fetch", "--quiet", "--filter=blob:none", "origin", ...missing]));
    return path;
  };

  const mergeBase = async (repo: string, head: string, baseSha: string): Promise<string> => {
    const key = `${repo}:${head}:${baseSha}`;
    const known = mergeBases.get(key);
    if (known) return known;
    const path = await ensure(repo, [head, baseSha]);
    const sha = (await git(path, ["merge-base", head, baseSha])).trim();
    mergeBases.set(key, sha);
    return sha;
  };

  const workspace = (repo: string): Promise<string> =>
    shared(`workspace:${repo}`, async () => {
      const path = join(base, "px0", slug(repo));
      if (await exists(join(path, ".git"))) return path;
      const repoPath = await mirror(repo);
      await git(repoPath, ["worktree", "prune"]);
      await mkdir(join(base, "px0"), { recursive: true });
      await git(repoPath, ["worktree", "add", "--quiet", "--no-checkout", "--detach", path, "HEAD"]);
      return path;
    });

  return {
    mergeBase,
    workspace,
    gitEnv,
    async show(repo: string, sha: string, path: string, maxBytes: number): Promise<string> {
      const repoPath = await ensure(repo, [sha]);
      const size = Number((await git(repoPath, ["cat-file", "-s", `${sha}:${path}`])).trim());
      if (size > maxBytes) throw new GitError(`${path} is too large to highlight`);
      return git(repoPath, ["cat-file", "blob", `${sha}:${path}`]);
    },
  };
}

export type Checkouts = ReturnType<typeof createCheckouts>;
