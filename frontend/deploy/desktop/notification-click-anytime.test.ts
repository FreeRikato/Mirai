import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * QML rendering is not run here (see fleet.test.ts), so this checks the
 * source directly: notify-send -A blocks until the alert is clicked or
 * dismissed, so the Process that runs it must not carry a stall timer that
 * kills it and moves on. A stall timer belongs only on the hub fetches,
 * which do need a timeout since curl can hang.
 */
const QML = readFileSync(join(import.meta.dir, "Fleet.qml"), "utf8");

test("the alert process has no stall timer, so a click reaches it whenever it happens", () => {
  expect(QML).not.toContain("notificationStall");
  expect(QML).not.toMatch(/notificationProcess\.running\s*=\s*false/);
});

test("hub fetches still have their own stall timer", () => {
  expect(QML).toContain("pollStall");
  expect(QML).toContain("if (pollProcess.running) { root.resetView(); pollProcess.running = false; }");
});
