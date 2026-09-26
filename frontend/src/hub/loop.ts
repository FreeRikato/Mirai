export type Loop = { start: () => void; now: () => void };

export function createLoop(fn: () => unknown, ms: () => number, label: string): Loop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = async () => {
    timer = null;
    try {
      await fn();
    } catch (err) {
      console.error(`[hub] ${label} failed`, err);
    }
    timer = setTimeout(run, ms());
  };
  return {
    start: () => void run(),
    now: () => {
      if (timer === null) return;
      clearTimeout(timer);
      void run();
    },
  };
}
