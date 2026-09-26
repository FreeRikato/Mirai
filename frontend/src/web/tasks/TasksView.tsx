import type { TaskBoard } from "@/shared/tasks";
import { AllTasks } from "./all/AllTasks";
import { GithubTasks } from "./github/GithubTasks";
import { LinearTasks } from "./linear/LinearTasks";
import { LocalTasks } from "./local/LocalTasks";

export function TasksView({ board }: { board: TaskBoard }) {
  switch (board) {
    case "all":
      return <AllTasks />;
    case "local":
      return <LocalTasks />;
    case "linear":
      return <LinearTasks />;
    case "github":
      return <GithubTasks />;
  }
}
