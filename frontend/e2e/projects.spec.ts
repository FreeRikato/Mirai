import { expect, test, type Page } from "@playwright/test";
import type { Container, Listener, ProjectsReport, ProjectsSnapshot, Worktree } from "../src/shared/projects";
import { mockHub } from "./fixtures";

const MB = 1 << 20;
const NOW = Date.now();

const wt = (path: string, repo: string, branch: string | null, dirty = 0): Worktree => ({ path, repo, branch, dirty, ahead: 0, behind: 0, lastCommit: NOW - 3_600_000 });
const listen = (port: number, pid: number, cwd: string, mem: number, process = "node-MainThread"): Listener => ({ port, bind: "0.0.0.0", pid, process, command: `${process} ${cwd}`, cwd, memBytes: mem * MB });
const box = (name: string, service: string, dir: string | null, ports: number[], mem: number, project: string | null = name.split("-")[0] ?? null): Container => ({ name, composeProject: project, composeService: service, workingDir: dir, ports, memBytes: mem * MB });

function slot(home: string, n: number, mem: { express: number; hasura: number }): ProjectsSnapshot {
  const root = `${home}/Developer`;
  const be = `${root}/Work/databrain-backend`;
  const fe = `${root}/Work/databrain-frontend`;
  const p = (x: number) => 20000 + n * 100 + x;
  return {
    at: NOW,
    root,
    worktrees: [wt(`${be}/worktrees/qa`, be, "qa", 5), wt(`${fe}/worktrees/qa`, fe, "qa", 2), wt(`${be}/worktrees/ram-lean`, be, "ram-lean", 2)],
    listeners: [
      listen(p(1), n * 1000 + 1, `${fe}/worktrees/qa/packages/@databrainhq/frontend`, 60),
      listen(p(3), n * 1000 + 3, `${be}/worktrees/qa/serverless/express`, mem.express),
      listen(p(85), n * 1000 + 5, `${be}/worktrees/qa/serverless/duckdb-server`, 119),
      listen(p(10), n * 1000 + 7, `${be}/worktrees/qa/forecast-timeseries`, 19, "uvicorn"),
      listen(3773, n * 1000 + 9, home, 200, "t3"),
    ],
    links: [
      { pid: n * 1000 + 3, port: p(82) },
      { pid: n * 1000 + 3, port: p(85) },
      { pid: n * 1000 + 3, port: p(10) },
      { pid: n * 1000 + 3, port: 5433 },
    ],
    containers: [box("qa-graphql-engine-1", "graphql-engine", `${be}/worktrees/qa`, [p(82)], mem.hasura), box("wt-shared-postgres-1", "postgres", `${root}/Work/shared`, [5433], 90, "wt-shared")],
  };
}

const archikato = slot("/home/archikato", 1, { express: 49, hasura: 394 });
const omarikato: ProjectsSnapshot = {
  ...slot("/home/omarikato", 7, { express: 382, hasura: 412 }),
  listeners: [...slot("/home/omarikato", 7, { express: 382, hasura: 412 }).listeners, listen(21999, 9001, "/home/omarikato/Developer/Work/databrain-backend/worktrees/gone/forecast (deleted)", 5, "python")],
};
const macato: ProjectsSnapshot = {
  at: NOW,
  root: "/Users/a/Developer",
  worktrees: [wt("/Users/a/Developer/Personal/Mirai", "/Users/a/Developer/Personal/Mirai", "main", 195)],
  listeners: [listen(3232, 501, "/Users/a/Developer/Personal/Mirai/frontend", 58, "bun")],
  links: [],
  containers: [],
};

const report: ProjectsReport = {
  at: NOW,
  hosts: [
    { host: "archikato", snapshot: archikato, error: null },
    { host: "macato", snapshot: macato, error: null },
    { host: "omarikato", snapshot: omarikato, error: null },
  ],
};

async function mockProjects(page: Page) {
  await mockHub(page);
  await page.route("**/api/projects", r => r.fulfill({ json: report }));
}

test("stack draws each project's services per worktree lane, wired by real connections, with orphans called out", async ({ page }) => {
  await mockProjects(page);
  await page.goto("/projects");
  const databrain = page.getByRole("region", { name: "databrain" });
  await expect(databrain).toContainText("qa");
  await expect(databrain.getByText("express", { exact: true })).toHaveCount(2);
  await expect(databrain.getByText("graphql-engine", { exact: true })).toHaveCount(2);
  await expect(databrain.locator("svg path[marker-end]")).toHaveCount(8);
  await expect(databrain).toContainText("2 idle worktrees");
  const orphans = page.getByRole("region", { name: "no worktree" });
  await expect(orphans).toContainText("folder deleted");
  await expect(page.getByRole("region", { name: "host tools" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/projects-stack.png", fullPage: true });
});

test("switching a machine off removes its lanes and stays off after a reload; host tools can be switched on", async ({ page }) => {
  await mockProjects(page);
  await page.goto("/projects");
  const machines = page.getByRole("group", { name: "machines" });
  await machines.getByRole("button", { name: "omarikato" }).click();
  await expect(page.getByRole("region", { name: "no worktree" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "databrain" }).getByText("express", { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(machines.getByRole("button", { name: "omarikato" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "host tools" }).click();
  await expect(page.getByRole("region", { name: "host tools" })).toContainText("t3");
});

test("treemap and sky show the same projects sized by memory", async ({ page }) => {
  await mockProjects(page);
  await page.goto("/projects");
  await page.getByRole("link", { name: "treemap" }).click();
  await expect(page).toHaveURL(/\/projects\/treemap$/);
  const block = page.getByRole("region", { name: "databrain" });
  await expect(block).toBeVisible();
  const express = block.locator('[title^="express :20703"]');
  const small = block.locator('[title^="express :20103"]');
  const area = async (l: typeof express) => {
    const b = await l.boundingBox();
    return b ? b.width * b.height : 0;
  };
  expect(await area(express)).toBeGreaterThan((await area(small)) * 4);
  await page.screenshot({ path: "test-results/projects-treemap.png" });
  await page.getByRole("link", { name: "sky" }).click();
  await expect(page.locator("svg text", { hasText: "databrain" })).toBeVisible();
  await expect(page.locator("svg circle")).not.toHaveCount(0);
  await page.screenshot({ path: "test-results/projects-sky.png" });
});
