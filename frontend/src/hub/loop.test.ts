import { expect, test } from "bun:test";
import { createLoop } from "./loop";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("now() runs a waiting loop at once and it then keeps the new pace, instead of sleeping out the old wait", async () => {
  let every = 10_000;
  let runs = 0;
  const loop = createLoop(() => runs++, () => every, "test");
  loop.start();
  await sleep(20);
  expect(runs).toBe(1);
  every = 30;
  loop.now();
  await sleep(10);
  expect(runs).toBe(2);
  await sleep(100);
  expect(runs).toBeGreaterThanOrEqual(4);
  every = 10_000;
  await sleep(50);
});

test("now() while a run is in flight does not start a second one", async () => {
  let active = 0;
  let most = 0;
  const loop = createLoop(
    async () => {
      active++;
      most = Math.max(most, active);
      await sleep(30);
      active--;
    },
    () => 10_000,
    "test",
  );
  loop.start();
  loop.now();
  loop.now();
  await sleep(60);
  expect(most).toBe(1);
});
