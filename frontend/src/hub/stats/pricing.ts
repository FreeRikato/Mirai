import type { Tokens } from "@/shared/usage";

export type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type RateTable = ReadonlyMap<string, Rate>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const bare = (key: string): string => key.slice(key.lastIndexOf("/") + 1);

const same = (a: Rate, b: Rate) => a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite;

export function parseRates(doc: unknown): RateTable {
  const table = new Map<string, Rate>();
  if (typeof doc !== "object" || doc === null) return table;
  for (const [name, raw] of Object.entries(doc)) {
    if (typeof raw !== "object" || raw === null) continue;
    const input = num(Reflect.get(raw, "input_cost_per_token"));
    const output = num(Reflect.get(raw, "output_cost_per_token"));
    if (input === null || output === null) continue;
    table.set(name.trim().toLowerCase(), {
      input,
      output,
      cacheRead: num(Reflect.get(raw, "cache_read_input_token_cost")) ?? input,
      cacheWrite: num(Reflect.get(raw, "cache_creation_input_token_cost")) ?? input,
    });
  }
  const aliases = new Map<string, Rate | null>();
  for (const [key, rate] of table) {
    const alias = bare(key);
    if (alias === key || table.has(alias)) continue;
    const held = aliases.get(alias);
    if (held === undefined) aliases.set(alias, rate);
    else if (held !== null && !same(held, rate)) aliases.set(alias, null);
  }
  for (const [alias, rate] of aliases) if (rate) table.set(alias, rate);
  return table;
}

export function rateFor(table: RateTable, model: string): Rate | null {
  const key = model.trim().toLowerCase();
  const base = key.includes("[") ? key.slice(0, key.indexOf("[")) : key;
  return table.get(base) ?? table.get(base.replace(/-\d{8}$/, "")) ?? null;
}

export const costOf = (r: Rate, t: Tokens): number => t.uncached * r.input + t.cached * r.cacheRead + t.cacheWrite * r.cacheWrite + t.output * r.output;

export const savingsOf = (r: Rate, t: Tokens): number => t.cached * Math.max(0, r.input - r.cacheRead);

export function createPrices(opts: { url: string; ttlMs: number; cacheFile: string; timeoutMs: number }) {
  let table: RateTable = new Map();
  let fetchedAt = 0;

  async function load() {
    try {
      const res = await fetch(opts.url, { signal: AbortSignal.timeout(opts.timeoutMs) });
      if (!res.ok) throw new Error(`prices answered ${res.status}`);
      const doc: unknown = await res.json();
      const next = parseRates(doc);
      if (next.size === 0) throw new Error("prices table was empty");
      table = next;
      fetchedAt = Date.now();
      await Bun.write(opts.cacheFile, JSON.stringify(doc));
    } catch (err) {
      console.error("[stats] could not refresh model prices", err);
      fetchedAt = Date.now();
      if (table.size === 0) {
        const cached = Bun.file(opts.cacheFile);
        if (await cached.exists()) table = parseRates(await cached.json());
      }
    }
  }

  return {
    async table(): Promise<RateTable> {
      if (table.size === 0) await load();
      else if (Date.now() - fetchedAt > opts.ttlMs) void load();
      return table;
    },
  };
}
