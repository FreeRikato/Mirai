import { describe, expect, test } from "bun:test";
import { place, sortByOrder } from "./order";

const self = (k: string) => k;

describe("sortByOrder", () => {
  test("ranked items follow the saved order, and unranked ones stay on top in the order they came", () => {
    expect(sortByOrder(["new1", "b", "new2", "a", "c"], self, ["a", "b", "c"])).toEqual(["new1", "new2", "a", "b", "c"]);
  });

  test("items sharing a key keep their incoming order", () => {
    expect(sortByOrder([{ k: "x", n: 1 }, { k: "y", n: 2 }, { k: "x", n: 3 }], i => i.k, ["y", "x"]).map(i => i.n)).toEqual([2, 1, 3]);
  });
});

describe("place", () => {
  test("puts the dragged key before or after the target, ranking whatever was shown but unsaved", () => {
    expect(place(["a", "b", "c"], ["new", "a", "b", "c"], "c", { key: "a", after: false })).toEqual(["new", "c", "a", "b"]);
    expect(place(["a", "b", "c"], ["a", "b", "c"], "a", { key: "b", after: true })).toEqual(["b", "a", "c"]);
  });

  test("keeps saved keys that are not on screen, and appends when there is no target", () => {
    expect(place(["hidden", "a", "b"], ["a", "b"], "a", null)).toEqual(["hidden", "b", "a"]);
  });
});
