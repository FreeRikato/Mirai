import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { WORTH } from "@/shared/later";

export const samples = sqliteTable(
  "samples",
  {
    machine: text("machine").notNull(),
    at: integer("at").notNull(),
    cpu: real("cpu").notNull(),
    mem: real("mem").notNull(),
    temp: real("temp"),
  },
  t => [primaryKey({ columns: [t.machine, t.at] }), index("samples_at").on(t.at)],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at").notNull(),
    machine: text("machine").notNull(),
    severity: text("severity", { enum: ["bad", "warn", "info"] }).notNull(),
    message: text("message").notNull(),
  },
  t => [index("events_at").on(t.at)],
);

export const priorityRankings = sqliteTable("priority_rankings", {
  id: integer("id").primaryKey(),
  rankedAt: integer("ranked_at").notNull(),
  costUsd: real("cost_usd").notNull(),
  items: text("items").notNull(),
});

export const taskOrders = sqliteTable("task_orders", {
  source: text("source", { enum: ["local", "linear", "github"] }).primaryKey(),
  keys: text("keys").notNull(),
});

export const laterFolders = sqliteTable("later_folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const laterItems = sqliteTable(
  "later_items",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull().unique(),
    kind: text("kind", { enum: ["read", "watch"] }).notNull(),
    embed: text("embed").notNull(),
    title: text("title").notNull(),
    site: text("site").notNull(),
    author: text("author"),
    image: text("image"),
    lengthSec: integer("length_sec"),
    progress: real("progress").notNull().default(0),
    position: real("position").notNull().default(0),
    state: text("state", { enum: ["unread", "progress", "done", "archived"] }).notNull().default("unread"),
    worth: text("worth", { enum: WORTH }).notNull(),
    tldr: text("tldr").notNull(),
    chapters: text("chapters").notNull(),
    content: text("content"),
    folderId: text("folder_id").references(() => laterFolders.id, { onDelete: "set null" }),
    folderOrder: real("folder_order").notNull().default(0),
    queueOrder: real("queue_order").notNull().default(0),
    savedAt: integer("saved_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  t => [index("later_saved_at").on(t.savedAt), index("later_queue_order").on(t.queueOrder)],
);

export const laterHighlights = sqliteTable(
  "later_highlights",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => laterItems.id, { onDelete: "cascade" }),
    quote: text("quote").notNull(),
    prefix: text("prefix").notNull(),
    suffix: text("suffix").notNull(),
    note: text("note").notNull().default(""),
    at: real("at"),
    createdAt: integer("created_at").notNull(),
  },
  t => [index("later_highlights_item").on(t.itemId)],
);

export const TRANSCRIPT_STATUSES = ["queued", "running", "ready", "failed"] as const;

export const laterTranscripts = sqliteTable("later_transcripts", {
  videoId: text("video_id").primaryKey(),
  status: text("status", { enum: TRANSCRIPT_STATUSES }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  retryAt: integer("retry_at"),
  model: text("model"),
  segments: text("segments"),
  error: text("error"),
  queuedAt: integer("queued_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
