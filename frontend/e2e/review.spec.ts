import { expect, test, type Page } from "@playwright/test";
import { parsePatch } from "../src/shared/diff";
import type { ServerMessage } from "../src/shared/schema";
import type { Highlight } from "../src/shared/code";
import { MarkViewedSchema, SubmitReviewSchema, type MarkViewed, type ReviewFile, type ShipReview, type ShipSnapshot, type SubmitReview } from "../src/shared/ship";
import { events, fleet, shipPr, withShipOrg } from "./fixtures";

const PR = shipPr({ id: "PR_3961", number: 3961, title: "feat: harden SQS transport for data operations workers", author: "jayakanth-infra", relation: "requested", pending: ["me"], why: "waiting on you", changedFiles: 3 });

const CONSUMER = [
  "@@ -41,6 +41,8 @@ export class SqsConsumer {",
  "   async poll(): Promise<void> {",
  "-    const msgs = await this.client.receive({ max: 10 });",
  "+    const free = this.slots.available();",
  "+    const msgs = await this.client.receive({ max: Math.min(free, 10) });",
  "     for (const msg of msgs) {",
  "-      void this.handle(msg);",
  "+      this.slots.run(() => this.handle(msg));",
  "     }",
  "   }",
].join("\n");

const file = (path: string, patch: string | null, viewed = false): ReviewFile => ({
  path,
  previous: null,
  status: "modified",
  additions: 3,
  deletions: 2,
  hunks: patch === null ? null : parsePatch(patch),
  viewed,
});

const READY: ShipReview = {
  kind: "ready",
  pr: PR,
  headSha: "abc123",
  baseSha: "def456",
  files: [file("docs/sqs.md", "@@ -1 +1 @@\n-old\n+new", true), file("src/workers/sqs/consumer.ts", CONSUMER), file("src/workers/sqs/diagram.png", null)],
  threads: [
    {
      id: "T_1",
      path: "src/workers/sqs/consumer.ts",
      side: "RIGHT",
      line: 45,
      originalLine: 45,
      resolved: false,
      outdated: false,
      comments: [{ author: "SapnaSinghKhatik", body: "If handle() throws the slot never frees.", html: "<p>If handle() throws the slot never frees.</p>", createdAt: new Date(Date.now() - 12 * 60_000).toISOString() }],
    },
  ],
};

async function mockReview(page: Page) {
  const submitted: SubmitReview[] = [];
  const viewed: MarkViewed[] = [];
  const snapshot: ShipSnapshot = { kind: "ready", org: "databrainhq", me: "me", mine: [], review: [PR], fetchedAt: Date.now() };
  await withShipOrg(page);
  await page.route("**/api/fleet", r => r.fulfill({ json: fleet }));
  await page.route("**/api/events", r => r.fulfill({ json: events }));
  await page.route("**/api/ship", r => r.fulfill({ json: snapshot }));
  await page.route("**/api/ship/body?**", r => r.fulfill({ json: { kind: "ready", html: "<p>stacked on #3959</p>" } }));
  await page.route("**/api/ship/review?**", r => (r.request().method() === "GET" ? r.fulfill({ json: READY }) : r.fallback()));
  await page.route("**/api/ship/review", r => {
    submitted.push(SubmitReviewSchema.parse(r.request().postDataJSON()));
    return r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/ship/viewed", r => {
    viewed.push(MarkViewedSchema.parse(r.request().postDataJSON()));
    return r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/code/**", r => r.fulfill({ json: { kind: "unavailable", reason: "not in this test" } }));
  await page.routeWebSocket("**/ws", ws => ws.send(JSON.stringify({ type: "fleet", fleet } satisfies ServerMessage)));
  return { submitted, viewed };
}

const files = (page: Page) => page.getByRole("complementary", { name: "changed files" });
const rail = (page: Page) => page.getByRole("complementary", { name: "review" });
const diff = (page: Page, path: string) => page.getByRole("table", { name: `diff of ${path}` });

test("review files from the preview: comment on lines, keep the draft across a reload, then submit it as one review", async ({ page }) => {
  const { submitted, viewed } = await mockReview(page);
  await page.goto("/ship/review");
  await page.getByRole("table", { name: "pull requests" }).getByText(PR.title).click();
  await page.getByRole("complementary", { name: "backend #3961" }).getByRole("button", { name: "review files" }).click();
  await expect(page).toHaveURL(/\/ship\/review\/PR_3961$/);

  await expect(files(page)).toContainText("1 / 3 viewed");
  await expect(files(page).getByRole("button", { name: "consumer.ts", exact: true })).toHaveAttribute("aria-current", "true");
  const consumer = diff(page, "src/workers/sqs/consumer.ts");
  await expect(consumer.getByText("const free = this.slots.available();")).toBeVisible();
  await expect(consumer.getByText("If handle() throws the slot never frees.")).toBeVisible();

  await consumer.getByRole("button", { name: "comment on old line 44" }).click();
  await page.getByRole("textbox", { name: "line comment" }).fill("the old path leaked a slot too");
  await page.getByRole("button", { name: "add to review" }).click();
  await consumer.getByRole("button", { name: "comment on line 43", exact: true }).click();
  await page.getByRole("textbox", { name: "line comment" }).fill("wrap handle in try/finally");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(rail(page)).toContainText("2 pending");
  await expect(files(page).locator('[data-file="src/workers/sqs/consumer.ts"]')).toContainText("3");

  await page.reload();
  await expect(rail(page)).toContainText("2 pending");
  await expect(diff(page, "src/workers/sqs/consumer.ts").getByText("wrap handle in try/finally")).toBeVisible();

  await page.keyboard.press("u");
  await expect(page.getByRole("radio", { name: "unified" })).toHaveAttribute("aria-checked", "true");
  await files(page).getByRole("button", { name: "mark consumer.ts viewed" }).click();
  await expect(files(page)).toContainText("2 / 3 viewed");
  expect(viewed).toEqual([{ id: "PR_3961", path: "src/workers/sqs/consumer.ts", viewed: true }]);

  await page.keyboard.press("n");
  await expect(page.getByText("no text diff (binary or too large to show)")).toBeVisible();

  await rail(page).getByRole("radio", { name: "request changes" }).click();
  await rail(page).getByRole("textbox", { name: "review summary" }).fill("one leak left");
  await rail(page).getByRole("button", { name: "submit review · 2 comments" }).click();
  await expect(rail(page)).toContainText("review submitted");
  await expect(rail(page)).toContainText("0 pending");
  expect(submitted).toEqual([
    {
      id: "PR_3961",
      headSha: "abc123",
      verdict: "changes",
      body: "one leak left",
      comments: [
        { path: "src/workers/sqs/consumer.ts", side: "LEFT", line: 44, body: "the old path leaked a slot too" },
        { path: "src/workers/sqs/consumer.ts", side: "RIGHT", line: 43, body: "wrap handle in try/finally" },
      ],
    },
  ]);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/ship\/review$/);
  await expect(page.getByRole("complementary", { name: "backend #3961" })).toBeVisible();
});

test("submit stays off until the review says something, and your own PR only takes comments", async ({ page }) => {
  await mockReview(page);
  await page.route("**/api/ship/review?**", r => r.fulfill({ json: { ...READY, pr: { ...PR, author: "me", relation: "author" } } }));
  await page.goto("/ship/review/PR_3961");
  await expect(rail(page).getByRole("button", { name: "submit review" })).toBeDisabled();
  await expect(rail(page)).toContainText("write a summary or a line comment");
  await expect(rail(page).getByRole("radio", { name: "approve" })).toBeDisabled();
  await rail(page).getByRole("textbox", { name: "review summary" }).fill("note to self");
  await expect(rail(page).getByRole("button", { name: "submit review" })).toBeEnabled();
});

test("a thread in the rail jumps to its file and line", async ({ page }) => {
  await mockReview(page);
  await page.goto("/ship/review/PR_3961");
  await files(page).getByRole("button", { name: "sqs.md", exact: true }).click();
  await rail(page).getByRole("button", { name: /consumer\.ts:45/ }).click();
  await expect(files(page).getByRole("button", { name: "consumer.ts", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(diff(page, "src/workers/sqs/consumer.ts").getByText("If handle() throws the slot never frees.")).toBeInViewport();
});

test("an outdated thread opens in the rail with its whole conversation, rendered", async ({ page }) => {
  await mockReview(page);
  const outdated = { id: "T_2", path: "src/workers/jobs/postgresBackgroundJobRepository.ts", side: "RIGHT" as const, line: null, originalLine: 212, resolved: false, outdated: true, comments: [{ author: "greptile-apps", body: '<a href="#"><img alt="P1" src="/p1.svg"></a> **Wildcard ownership blocks redrive** when a job uses `*`.', html: '<p><a href="#"><img alt="P1" src="/p1.svg"></a> <strong>Wildcard ownership blocks redrive</strong> when a job uses <code>*</code>.</p>', createdAt: new Date().toISOString() }, { author: "jayakanth-infra", body: "fixed in the next commit", html: "<p>fixed in the next commit</p>", createdAt: new Date().toISOString() }] };
  await page.route("**/api/ship/review?**", r => r.fulfill({ json: { ...READY, threads: [outdated] } }));
  await page.goto("/ship/review/PR_3961");
  const item = rail(page).getByRole("button", { name: /postgresBackgroundJobRepository\.ts:212/ });
  await expect(item).toContainText("greptile-apps: Wildcard ownership blocks redrive when a job uses");
  await expect(item).not.toContainText("**");
  await expect(item).not.toContainText("<img");
  await item.click();
  await expect(item).toHaveAttribute("aria-expanded", "true");
  await expect(rail(page).getByText("it was line 212")).toBeVisible();
  await expect(rail(page).locator("strong", { hasText: "Wildcard ownership blocks redrive" })).toBeVisible();
  await expect(rail(page).getByText("fixed in the next commit")).toBeVisible();
  await expect(rail(page).getByRole("img", { name: "P1" })).toBeAttached();
  await expect(rail(page)).not.toContainText("<a href");
});

test("an image that is a link to somewhere else stays a link, while a plain image opens the preview", async ({ page }) => {
  await mockReview(page);
  const badge = '<a href="https://example.com/fix"><img alt="Fix in Claude Code" src="/badge.png" width="100" height="20"></a>';
  const shot = '<img alt="Screenshot" src="/shot.png" width="200" height="120">';
  const thread = { ...READY.threads[0], id: "T_3", comments: [{ author: "greptile-apps", body: "", html: `<p>${badge}</p><p>${shot}</p>`, createdAt: new Date().toISOString() }] };
  await page.route("**/api/ship/review?**", r => r.fulfill({ json: { ...READY, threads: [thread] } }));
  await page.route(/\/(badge|shot)\.png$/, r => r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"/>' }));
  await page.route("https://example.com/**", r => r.fulfill({ body: "fix page" }));
  await page.goto("/ship/review/PR_3961");
  const code = diff(page, "src/workers/sqs/consumer.ts");
  await code.getByRole("img", { name: "Screenshot" }).click();
  await expect(page.getByRole("dialog", { name: "Screenshot" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/ship\/review\/PR_3961$/);
  const opened = page.context().waitForEvent("page");
  await code.getByRole("img", { name: "Fix in Claude Code" }).click();
  expect((await opened).url()).toBe("https://example.com/fix");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

const KEYWORD = "#c49bff";
const CONSUMER_HEAD: Record<number, string> = {
  41: "  async poll(): Promise<void> {",
  42: "    const free = this.slots.available();",
  43: "    const msgs = await this.client.receive({ max: Math.min(free, 10) });",
  44: "    for (const msg of msgs) {",
  45: "      this.slots.run(() => this.handle(msg));",
  46: "    }",
  47: "  }",
};

const tokenized = (text: string) => text.split(/(const)/).filter(Boolean).map(t => [t, t === "const" ? KEYWORD : "#ffffff"] as const);

test("syntax colours are off until you ask for them, stay as you left them, and cost nothing while off", async ({ page }) => {
  await mockReview(page);
  const asked: string[] = [];
  const highlight: Highlight = { kind: "ready", lines: Array.from({ length: 48 }, (_, i) => tokenized(CONSUMER_HEAD[i + 1] ?? "")) };
  await page.route("**/api/code/highlight?**", r => {
    asked.push(new URL(r.request().url()).searchParams.get("side") ?? "");
    return r.fulfill({ json: new URL(r.request().url()).searchParams.get("side") === "new" ? highlight : { kind: "unavailable", reason: "old side not needed" } });
  });
  await page.goto("/ship/review/PR_3961");
  const toggle = page.getByRole("button", { name: "colours" });
  const consumer = diff(page, "src/workers/sqs/consumer.ts");
  const keyword = consumer.getByRole("button", { name: "comment on line 42", exact: true }).locator("span", { hasText: /^const$/ });
  await expect(consumer.getByText("const free = this.slots.available();")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(keyword).toHaveCount(0);
  expect(asked).toEqual([]);

  await page.keyboard.press("c");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(keyword).toHaveCSS("color", "rgb(196, 155, 255)");
  await consumer.getByRole("button", { name: "comment on line 43", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "line comment" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByRole("button", { name: "colours" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "colours" }).click();
  await expect(page.getByRole("button", { name: "colours" })).toHaveAttribute("aria-pressed", "false");
  await expect(keyword).toHaveCount(0);
});
