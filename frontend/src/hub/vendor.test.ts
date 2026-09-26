import { expect, test } from "bun:test";
import { vendorFile } from "./vendor";

test("vendor files are ES modules inside the package folder, nothing else", () => {
  expect(vendorFile("/app/node_modules/mermaid/dist", "mermaid.esm.min.mjs")).toBe("/app/node_modules/mermaid/dist/mermaid.esm.min.mjs");
  expect(vendorFile("/app/node_modules/mermaid/dist", "chunks/mermaid.esm.min/chunk-S4TE5DX6.mjs")).toBe("/app/node_modules/mermaid/dist/chunks/mermaid.esm.min/chunk-S4TE5DX6.mjs");
  expect(vendorFile("/app/node_modules/mermaid/dist", "../../../src/index.mjs")).toBeNull();
  expect(vendorFile("/app/node_modules/mermaid/dist", "../package.json")).toBeNull();
  expect(vendorFile("/app/node_modules/mermaid/dist", "mermaid.esm.min.mjs.map")).toBeNull();
});
