import { afterEach, expect, setSystemTime, test } from "bun:test";
import { cached, paginate } from "./remote";

test("paginate follows cursors until the last page and keeps order", async () => {
  const pages: Record<string, { nodes: number[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> = {
    start: { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: "a" } },
    a: { nodes: [3], pageInfo: { hasNextPage: true, endCursor: "b" } },
    b: { nodes: [4], pageInfo: { hasNextPage: false, endCursor: null } },
  };
  const seen: (string | null)[] = [];
  const out = await paginate(async after => {
    seen.push(after);
    const page = pages[after ?? "start"];
    if (!page) throw new Error("unknown cursor");
    return page;
  }, 20);
  expect(out).toEqual([1, 2, 3, 4]);
  expect(seen).toEqual([null, "a", "b"]);
});

test("paginate refuses to run away when a source keeps saying there is more", async () => {
  await expect(paginate(async () => ({ nodes: [0], pageInfo: { hasNextPage: true, endCursor: "same" } }), 3)).rejects.toThrow("more than 3 pages");
});

function source() {
  let n = 0;
  let fail = false;
  return {
    calls: () => n,
    failNext: (v: boolean) => (fail = v),
    load: async () => {
      n++;
      if (fail) throw new Error("upstream down");
      return `v${n}`;
    },
  };
}

afterEach(() => setSystemTime());

test("cached: concurrent first callers share one load, and a fresh value is reused", async () => {
  setSystemTime(new Date("2026-09-24T10:00:00Z"));
  const src = source();
  const c = cached(src.load, 30_000);
  const [a, b] = await Promise.all([c.get(), c.get()]);
  expect([a.value, b.value, src.calls()]).toEqual(["v1", "v1", 1]);
  expect(a.at).toBe(Date.parse("2026-09-24T10:00:00Z"));
  setSystemTime(new Date("2026-09-24T10:00:20Z"));
  expect((await c.get()).value).toBe("v1");
  expect(src.calls()).toBe(1);
});

test("cached: past the ttl it answers with the old value at once and refreshes behind it", async () => {
  setSystemTime(new Date("2026-09-24T10:00:00Z"));
  const src = source();
  const c = cached(src.load, 30_000);
  await c.get();
  setSystemTime(new Date("2026-09-24T10:01:00Z"));
  const stale = await c.get();
  expect(stale).toEqual({ value: "v1", at: Date.parse("2026-09-24T10:00:00Z") });
  expect(src.calls()).toBe(2);
  await Bun.sleep(0);
  expect(await c.get()).toEqual({ value: "v2", at: Date.parse("2026-09-24T10:01:00Z") });
});

test("cached: a failed refresh keeps the last good value and waits a ttl before trying again", async () => {
  setSystemTime(new Date("2026-09-24T10:00:00Z"));
  const src = source();
  const c = cached(src.load, 30_000);
  await c.get();
  src.failNext(true);
  setSystemTime(new Date("2026-09-24T10:01:00Z"));
  expect((await c.get()).value).toBe("v1");
  await Bun.sleep(0);
  expect((await c.get()).value).toBe("v1");
  expect(src.calls()).toBe(2);
  setSystemTime(new Date("2026-09-24T10:01:31Z"));
  src.failNext(false);
  expect((await c.get()).value).toBe("v1");
  await Bun.sleep(0);
  expect((await c.get()).value).toBe("v3");
});

test("cached: with nothing cached a failure reaches the caller and the next call retries", async () => {
  const src = source();
  const c = cached(src.load, 30_000);
  src.failNext(true);
  await expect(c.get()).rejects.toThrow("upstream down");
  src.failNext(false);
  expect((await c.get()).value).toBe("v2");
});

test("cached: after invalidate the next call waits for a fresh load, and an older refresh cannot overwrite it", async () => {
  setSystemTime(new Date("2026-09-24T10:00:00Z"));
  let release: (v: string) => void = () => {};
  let n = 0;
  const c = cached(() => (++n === 2 ? new Promise<string>(r => (release = r)) : Promise.resolve(`v${n}`)), 30_000);
  await c.get();
  setSystemTime(new Date("2026-09-24T10:01:00Z"));
  await c.get();
  c.invalidate();
  expect((await c.get()).value).toBe("v3");
  release("v2-late");
  await Bun.sleep(0);
  expect((await c.get()).value).toBe("v3");
});
