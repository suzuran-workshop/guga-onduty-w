CREATE TABLE `appealTokens` (
	`tokenHash` text PRIMARY KEY,
	`recordId` text NOT NULL,
	`teacherDingtalkId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`consumedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dingtalkContacts` (
	`userId` text PRIMARY KEY,
	`unionId` text,
	`name` text NOT NULL,
	`mobile` text,
	`title` text,
	`avatarUrl` text,
	`deptIds` text,
	`deptNames` text,
	`syncedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notificationLogs` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`recipientUserId` text,
	`recipientPlatformId` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`recordId` text,
	`week` text,
	`title` text,
	`dedupeKey` text,
	`providerTaskId` text,
	`error` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sentAt` integer,
	CONSTRAINT "notification_logs_kind_check" CHECK(kind IN ('record_deduction', 'record_positive', 'weekly_report')),
	CONSTRAINT "notification_logs_status_check" CHECK(status IN ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE `appeals` ADD `campusId` text NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `teacherDingtalkId` text;--> statement-breakpoint
ALTER TABLE `records` ADD `tagIds` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_records` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`classId` text NOT NULL,
	`recorderId` text NOT NULL,
	`tagIds` text,
	`score` real DEFAULT 0 NOT NULL,
	`comment` text,
	`images` text,
	`week` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`recordedAt` integer NOT NULL,
	CONSTRAINT "records_status_check" CHECK(status IN ('active', 'revoked', 'appealing'))
);
--> statement-breakpoint
INSERT INTO `__new_records`(`id`, `campusId`, `classId`, `recorderId`, `score`, `comment`, `images`, `week`, `status`, `recordedAt`) SELECT `id`, `campusId`, `classId`, `recorderId`, `score`, `comment`, `images`, `week`, `status`, `recordedAt` FROM `records`;--> statement-breakpoint
DROP TABLE `records`;--> statement-breakpoint
ALTER TABLE `__new_records` RENAME TO `records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recordLogs` (
	`id` text PRIMARY KEY,
	`recordId` text NOT NULL,
	`action` text NOT NULL,
	`operatorId` text NOT NULL,
	`reason` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "record_logs_action_check" CHECK(action IN ('create', 'revoke', 'appeal', 'adjust', 'appeal_reject'))
);
--> statement-breakpoint
INSERT INTO `__new_recordLogs`(`id`, `recordId`, `action`, `operatorId`, `reason`, `createdAt`) SELECT `id`, `recordId`, `action`, `operatorId`, `reason`, `createdAt` FROM `recordLogs`;--> statement-breakpoint
DROP TABLE `recordLogs`;--> statement-breakpoint
ALTER TABLE `__new_recordLogs` RENAME TO `recordLogs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `records_campus_week_idx` ON `records` (`campusId`,`week`);--> statement-breakpoint
CREATE INDEX `records_class_idx` ON `records` (`classId`);--> statement-breakpoint
CREATE INDEX `records_status_idx` ON `records` (`status`);--> statement-breakpoint
CREATE INDEX `record_logs_record_idx` ON `recordLogs` (`recordId`);--> statement-breakpoint
CREATE INDEX `appeal_tokens_record_idx` ON `appealTokens` (`recordId`);--> statement-breakpoint
CREATE INDEX `appeal_tokens_expires_idx` ON `appealTokens` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `appeals_campus_idx` ON `appeals` (`campusId`);--> statement-breakpoint
CREATE INDEX `classes_teacher_idx` ON `classes` (`teacherDingtalkId`);--> statement-breakpoint
CREATE INDEX `dingtalk_contacts_name_idx` ON `dingtalkContacts` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_logs_dedupe_uidx` ON `notificationLogs` (`dedupeKey`);--> statement-breakpoint
CREATE INDEX `notification_logs_campus_idx` ON `notificationLogs` (`campusId`);--> statement-breakpoint
CREATE INDEX `notification_logs_status_idx` ON `notificationLogs` (`status`);--> statement-breakpoint
CREATE INDEX `notification_logs_record_idx` ON `notificationLogs` (`recordId`);