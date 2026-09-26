ALTER TABLE `later_items` ADD `queue_order` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `later_queue_order` ON `later_items` (`queue_order`);--> statement-breakpoint
UPDATE `later_items` SET `queue_order` = `saved_at`;