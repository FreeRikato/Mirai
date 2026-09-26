import { expect, test } from "bun:test";
import { openDb } from "../db";
import { createOrderStore } from "./orderStore";

test("each source keeps its own saved order, and a new save replaces the old one", () => {
  const store = createOrderStore(openDb(":memory:"));
  expect(store.load()).toEqual({ local: [], linear: [], github: [] });
  store.save({ source: "linear", keys: ["b", "a"] });
  store.save({ source: "github", keys: ["x"] });
  store.save({ source: "linear", keys: ["a", "b"] });
  expect(store.load()).toEqual({ local: [], linear: ["a", "b"], github: ["x"] });
});
