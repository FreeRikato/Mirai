import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * QML rendering is not run here (see fleet.test.ts), so this checks the
 * source directly: omarchy-notification-send fires one D-Bus Notify call and
 * returns, with the click command riding along as a hint that Omarchy itself
 * keeps bound to the toast (server side, even across a shell restart). A
 * click can land whenever it happens because nothing in Mirai needs to still
 * be alive to catch it, which rules out notify-send's own -A/action mode
 * (its click reaches only a still-running notify-send) or any process here
 * that waits on the alert's stdout for a click.
 */
const QML = readFileSync(join(import.meta.dir, "Fleet.qml"), "utf8");

test("alerts carry their click command as --exec on omarchy-notification-send, not a waiting process", () => {
  expect(QML).toContain("omarchy-notification-send");
  expect(QML).toContain("--exec");
  expect(QML).not.toContain("notify-send");
  expect(QML).not.toMatch(/-A\s+open=Open/);
});

test("nothing waits on the alert's own output for a click", () => {
  expect(QML).not.toContain("notificationStall");
  expect(QML).not.toContain("notificationOutput");
});

test("hub fetches still have their own stall timer", () => {
  expect(QML).toContain("pollStall");
  expect(QML).toContain("if (pollProcess.running) { root.resetView(); pollProcess.running = false; }");
});
