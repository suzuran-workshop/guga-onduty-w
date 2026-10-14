CREATE TABLE `dutyAreas` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`name` text NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dutyCheckins` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`scheduleId` text NOT NULL,
	`dutyDate` text NOT NULL,
	`teacherId` text NOT NULL,
	`locationName` text NOT NULL,
	`timeSlotName` text,
	`situation` text,
	`photos` text NOT NULL,
	`checkedInAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dutyInspections` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`inspectorId` text NOT NULL,
	`inspectDate` text NOT NULL,
	`areaId` text NOT NULL,
	`items` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dutyLocations` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`areaId` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dutySchedules` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`kind` text DEFAULT 'teaching' NOT NULL,
	`areaId` text NOT NULL,
	`timeSlotId` text,
	`locationId` text,
	`dateStart` text NOT NULL,
	`dateEnd` text NOT NULL,
	`weekday` integer NOT NULL,
	`weekParity` text DEFAULT 'everyweek' NOT NULL,
	`countersign` integer DEFAULT 0 NOT NULL,
	`assigneeIds` text NOT NULL,
	`note` text,
	CONSTRAINT "duty_schedules_kind_check" CHECK(kind IN ('teaching', 'dutyWeek')),
	CONSTRAINT "duty_schedules_parity_check" CHECK(weekParity IN ('everyweek', 'odd', 'even'))
);
--> statement-breakpoint
CREATE TABLE `dutySwaps` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`type` text NOT NULL,
	`applicantId` text NOT NULL,
	`applicantScheduleId` text NOT NULL,
	`applicantDate` text NOT NULL,
	`targetId` text NOT NULL,
	`targetScheduleId` text,
	`targetDate` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewerId` text,
	`reviewComment` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`reviewedAt` integer,
	CONSTRAINT "duty_swaps_type_check" CHECK(type IN ('swap', 'proxy')),
	CONSTRAINT "duty_swaps_status_check" CHECK(status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `dutyTimeSlots` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`areaId` text NOT NULL,
	`name` text NOT NULL,
	`startMinute` integer,
	`endMinute` integer,
	`priority` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `canInspect` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `duty_areas_campus_name_uidx` ON `dutyAreas` (`campusId`,`name`);--> statement-breakpoint
CREATE INDEX `duty_areas_campus_idx` ON `dutyAreas` (`campusId`);--> statement-breakpoint
CREATE UNIQUE INDEX `duty_checkins_uniq` ON `dutyCheckins` (`scheduleId`,`dutyDate`,`teacherId`);--> statement-breakpoint
CREATE INDEX `duty_checkins_campus_date_idx` ON `dutyCheckins` (`campusId`,`dutyDate`);--> statement-breakpoint
CREATE INDEX `duty_checkins_teacher_idx` ON `dutyCheckins` (`teacherId`);--> statement-breakpoint
CREATE INDEX `duty_inspections_campus_date_idx` ON `dutyInspections` (`campusId`,`inspectDate`);--> statement-breakpoint
CREATE UNIQUE INDEX `duty_locations_campus_area_name_uidx` ON `dutyLocations` (`campusId`,`areaId`,`name`);--> statement-breakpoint
CREATE INDEX `duty_locations_campus_idx` ON `dutyLocations` (`campusId`);--> statement-breakpoint
CREATE INDEX `duty_locations_area_idx` ON `dutyLocations` (`areaId`);--> statement-breakpoint
CREATE INDEX `duty_schedules_campus_kind_idx` ON `dutySchedules` (`campusId`,`kind`);--> statement-breakpoint
CREATE INDEX `duty_schedules_area_idx` ON `dutySchedules` (`areaId`);--> statement-breakpoint
CREATE INDEX `duty_swaps_campus_status_idx` ON `dutySwaps` (`campusId`,`status`);--> statement-breakpoint
CREATE INDEX `duty_swaps_applicant_idx` ON `dutySwaps` (`applicantId`);--> statement-breakpoint
CREATE INDEX `duty_timeslots_campus_idx` ON `dutyTimeSlots` (`campusId`);--> statement-breakpoint
CREATE INDEX `duty_timeslots_area_idx` ON `dutyTimeSlots` (`areaId`);