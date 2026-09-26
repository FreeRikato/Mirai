import { expect, test } from "bun:test";
import { contentPath, folderHref, laterHref, notesHref, parseRoute, reviewHref, shipHref } from "./router";

test("notes routes round-trip link targets that contain folders", () => {
  expect(parseRoute("/notes")).toEqual({ module: "notes", target: null });
  expect(parseRoute(notesHref("aws/aws-iam"))).toEqual({ module: "notes", target: "aws/aws-iam" });
  expect(parseRoute("/notes/aws/aws-iam")).toEqual({ module: "notes", target: "aws/aws-iam" });
  expect(parseRoute("/notes/%E0%A4%A")).toEqual({ module: "notes", target: null });
});

test("stats has one route whatever follows it", () => {
  expect(parseRoute("/stats")).toEqual({ module: "stats" });
  expect(parseRoute("/stats/ai")).toEqual({ module: "stats" });
});

test("ship routes carry the queue and, while reviewing, the pull request id", () => {
  expect(parseRoute(shipHref("mine"))).toEqual({ module: "ship", queue: "mine", review: null });
  expect(parseRoute(shipHref("review"))).toEqual({ module: "ship", queue: "review", review: null });
  expect(parseRoute(reviewHref("mine", "PR_kwDO1"))).toEqual({ module: "ship", queue: "mine", review: "PR_kwDO1" });
  expect(parseRoute(reviewHref("all", "PR_kwDO2"))).toEqual({ module: "ship", queue: "all", review: "PR_kwDO2" });
  expect(parseRoute("/ship/nope/PR_3")).toEqual({ module: "ship", queue: "mine", review: null });
});

test("a malformed host in the url falls back to the fleet instead of throwing", () => {
  expect(parseRoute("/machines/%E0%A4%A")).toEqual({ module: "machines", host: null });
  expect(parseRoute("/machines/mac%20mini")).toEqual({ module: "machines", host: "mac mini" });
});

test("content lives at /content, keeps old /later links working, and opens folders by id", () => {
  expect(parseRoute("/content")).toEqual({ module: "later", view: { by: "kind", kind: "read" } });
  expect(parseRoute("/later/watch")).toEqual({ module: "later", view: { by: "kind", kind: "watch" } });
  expect(parseRoute("/content/folder/a%20b")).toEqual({ module: "later", view: { by: "folder", folder: "a b" } });
  expect(parseRoute("/content/item/19d31f46-6038")).toEqual({ module: "later", view: { by: "item", id: "19d31f46-6038" } });
  expect([laterHref("read"), laterHref("watch"), folderHref("a b")]).toEqual(["/content", "/content/watch", "/content/folder/a%20b"]);
  expect([contentPath("/later"), contentPath("/later/watch"), contentPath("/latershow")]).toEqual(["/content", "/content/watch", "/latershow"]);
});
