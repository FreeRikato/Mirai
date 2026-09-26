import { z } from "zod";
import type { TokenLine } from "@/shared/code";

const LinesSchema = z.array(z.array(z.tuple([z.string(), z.string()])));

export function createHighlight({ bin, timeoutMs }: { bin: string; timeoutMs: number }) {
  return async (path: string, text: string): Promise<TokenLine[]> => {
    const proc = Bun.spawn([bin, "highlight", path], { stdin: new Blob([text]), stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`highlighting failed: ${err.trim() || `exit ${code}`}`);
    return LinesSchema.parse(JSON.parse(out));
  };
}

export type Highlighter = ReturnType<typeof createHighlight>;
