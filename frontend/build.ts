import { rm } from "node:fs/promises";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import tailwind from "bun-plugin-tailwind";
import reactCompiler from "./reactCompilerPlugin";

const outdir = `${import.meta.dir}/dist`;
await rm(outdir, { recursive: true, force: true });
const started = performance.now();
const out = await Bun.build({
  entrypoints: [`${import.meta.dir}/src/index.html`],
  outdir,
  publicPath: "/",
  minify: true,
  splitting: true,
  target: "browser",
  env: "BUN_PUBLIC_*",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [tailwind, reactCompiler],
});
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
const COMPRESSIBLE = /\.(js|css|html|svg|webmanifest|json)$/;
for (const file of out.outputs.filter(o => COMPRESSIBLE.test(o.path))) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await Bun.write(`${file.path}.br`, brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  await Bun.write(`${file.path}.gz`, gzipSync(bytes, { level: 9 }));
}
console.log(`web app built into dist/ in ${Math.round(performance.now() - started)} ms`);
