import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * omarchy-notification-send gives each call its own toast, tracked server
 * side, so nothing needs to queue behind one that has not been dismissed
 * yet. A pendingNotices/activeNotice gate that shows one alert at a time and
 * waits for it to finish before starting the next would hold back every bad
 * event but the first in a poll.
 */
const QML = readFileSync(join(import.meta.dir, "Fleet.qml"), "utf8");

test("no queue or single-active-notice gate holds a later alert back", () => {
  expect(QML).not.toContain("pendingNotices");
  expect(QML).not.toContain("activeNotice");
});

test("every notice from a poll is sent immediately, not just the first", () => {
  expect(QML).toMatch(/result\.notify\.forEach\(root\.sendNotice\)/);
});
