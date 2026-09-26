import { z } from "zod";
import type { TaskOrder, TaskOrders } from "@/shared/tasks";
import type { Db } from "../db";
import { taskOrders } from "../db/schema";

const KeysSchema = z.array(z.string());

export function createOrderStore(db: Db) {
  function load(): TaskOrders {
    const orders: TaskOrders = { local: [], linear: [], github: [] };
    for (const row of db.select().from(taskOrders).all()) {
      const keys = KeysSchema.safeParse(JSON.parse(row.keys));
      if (keys.success) orders[row.source] = keys.data;
    }
    return orders;
  }

  function save({ source, keys }: TaskOrder) {
    const value = JSON.stringify(keys);
    db.insert(taskOrders).values({ source, keys: value }).onConflictDoUpdate({ target: taskOrders.source, set: { keys: value } }).run();
  }

  return { load, save };
}
