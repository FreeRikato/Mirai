import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

/*
 * Runs the real hub on a spare port with an in-memory database, then plays the
 * Desktop app with plain WebSockets and the launcher with plain POSTs.
 */
setDefaultTimeout(20_000);

const PORT = 21_000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${PORT}`;
let hub: Bun.Subprocess | null = null;

beforeAll(async () => {
  hub = Bun.spawn([process.execPath, "src/index.ts"], {
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, PORT: String(PORT), MIRAI_DB: ":memory:" },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 200; i++) {
    if (await fetch(`${base}/api/events`).then(r => r.ok, () => false)) return;
    await Bun.sleep(100);
  }
  throw new Error(`the hub did not come up on ${base}`);
}, 30_000);

afterAll(() => {
  hub?.kill();
});

type Socket = { readonly ws: WebSocket; readonly opens: unknown[] };
const sockets: Socket[] = [];

afterEach(() => {
  for (const s of sockets.splice(0)) s.ws.close();
});

async function connect(machine: string | null): Promise<Socket> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const opens: unknown[] = [];
  ws.addEventListener("message", e => {
    const msg: unknown = JSON.parse(String(e.data));
    if (typeof msg === "object" && msg !== null && "type" in msg && msg.type === "open") opens.push(msg);
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
  });
  ws.send(JSON.stringify({ type: "watch", fleet: false, host: null }));
  if (machine) ws.send(JSON.stringify({ type: "desktop", machine }));
  const s = { ws, opens };
  sockets.push(s);
  return s;
}

const open = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/desktop/open`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/* A subscription lands asynchronously after the socket message, so wait until the hub counts it. */
async function openUntilDelivered(body: { machine: string; path: string }, want: number): Promise<unknown> {
  let last: unknown = null;
  for (let i = 0; i < 40; i++) {
    const res = await open(body);
    last = await res.json();
    if (typeof last === "object" && last !== null && "delivered" in last && last.delivered === want) return last;
    await Bun.sleep(50);
  }
  return last;
}

const settle = () => Bun.sleep(300);

test("a Desktop app subscribed for its machine gets the path and the hub counts it as delivered", async () => {
  const win = await connect("box");
  expect(await openUntilDelivered({ machine: "box", path: "/ship" }, 1)).toEqual({ delivered: 1 });
  await settle();
  expect(win.opens.at(-1)).toEqual({ type: "open", path: "/ship" });
});

test("a path can carry a query, such as the mirAI deep link", async () => {
  const win = await connect("box");
  expect(await openUntilDelivered({ machine: "box", path: "/machines?mirai=1" }, 1)).toEqual({ delivered: 1 });
  await settle();
  expect(win.opens.at(-1)).toEqual({ type: "open", path: "/machines?mirai=1" });
});

test("only windows of that machine hear it: another machine's Desktop app and a Browser tab get nothing", async () => {
  const box = await connect("box");
  const other = await connect("other");
  const tab = await connect(null);
  expect(await openUntilDelivered({ machine: "box", path: "/tasks" }, 1)).toEqual({ delivered: 1 });
  await settle();
  expect(box.opens.length).toBeGreaterThan(0);
  expect(other.opens).toEqual([]);
  expect(tab.opens).toEqual([]);
});

test("with no Desktop app open for the machine nothing is delivered", async () => {
  const res = await open({ machine: "nobody-here", path: "/machines" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ delivered: 0 });
});

test("a closed Desktop app stops counting", async () => {
  const win = await connect("closing");
  expect(await openUntilDelivered({ machine: "closing", path: "/notes" }, 1)).toEqual({ delivered: 1 });
  win.ws.close();
  expect(await openUntilDelivered({ machine: "closing", path: "/notes" }, 0)).toEqual({ delivered: 0 });
});

test("a path must be a path on the hub: not relative, not another origin", async () => {
  const win = await connect("box");
  await openUntilDelivered({ machine: "box", path: "/stats" }, 1);
  await settle();
  const before = win.opens.length;
  for (const body of [{ machine: "box", path: "ship" }, { machine: "box", path: "https://evil.example/ship" }, { machine: "box", path: "//evil.example/ship" }, { machine: "box" }, { path: "/ship" }, { machine: "", path: "/ship" }]) {
    const res = await open(body);
    expect({ body, status: res.status }).toEqual({ body, status: 400 });
  }
  await settle();
  expect(win.opens.length).toBe(before);
});

test("a page on another origin cannot drive the Desktop app", async () => {
  const win = await connect("box");
  await openUntilDelivered({ machine: "box", path: "/stats" }, 1);
  await settle();
  const before = win.opens.length;
  const res = await open({ machine: "box", path: "/ship" }, { origin: "https://evil.example" });
  expect(res.status).toBe(403);
  await settle();
  expect(win.opens.length).toBe(before);
});
