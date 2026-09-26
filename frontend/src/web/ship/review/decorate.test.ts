import { expect, test } from "bun:test";
import { segments } from "./decorate";

test("tokens that match the diff line keep their colours and positions", () => {
  expect(segments("const a;", [["const", "#c49bff"], [" a;", "#ffffff"]])).toEqual([
    { start: 0, text: "const", color: "#c49bff" },
    { start: 5, text: " a;", color: "#ffffff" },
  ]);
});

test("tokens that do not match the diff text are dropped instead of drawing the wrong colours", () => {
  expect(segments("const x = 1;", [["const y", "#c49bff"]])).toEqual([{ start: 0, text: "const x = 1;", color: null }]);
});
