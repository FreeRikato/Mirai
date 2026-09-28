import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const QML = readFileSync(join(import.meta.dir, "Fleet.qml"), "utf8");

test("Fleet QML renders the table popup and actionable critical notifications", () => {
  expect(QML).toContain('PopupCard {');
  expect(QML).toContain('triggerMode: "hover"');
  for (const heading of ["machine", "cpu", "mem", "temp", "disk"]) expect(QML).toContain(`text: "${heading}"`);
  expect(QML).toContain("omarchy-notification-send");
  expect(QML).toContain("sendNotice");
  expect(QML).toContain("notice.command");
});

test("failed and stalled polls reset the entire widget view", () => {
  expect(QML).toContain("function resetView()");
  expect(QML).toMatch(/catch \(error\) \{\s*resetView\(\)/);
  expect(QML).toMatch(/else root\.resetView\(\)/);
  expect(QML).toContain("onTriggered: if (pollProcess.running) { root.resetView(); pollProcess.running = false; }");
});
