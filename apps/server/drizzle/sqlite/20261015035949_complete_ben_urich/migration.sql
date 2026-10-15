DROP INDEX IF EXISTS `duty_areas_campus_name_uidx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_areas_campus_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_checkins_uniq`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_checkins_campus_date_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_checkins_teacher_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_inspections_campus_date_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_locations_campus_area_name_uidx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_locations_campus_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_locations_area_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_schedules_campus_kind_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_schedules_area_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_swaps_campus_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_swaps_applicant_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_timeslots_campus_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `duty_timeslots_area_idx`;--> statement-breakpoint
DROP TABLE `dutyAreas`;--> statement-breakpoint
DROP TABLE `dutyCheckins`;--> statement-breakpoint
DROP TABLE `dutyInspections`;--> statement-breakpoint
DROP TABLE `dutyLocations`;--> statement-breakpoint
DROP TABLE `dutySchedules`;--> statement-breakpoint
DROP TABLE `dutySwaps`;--> statement-breakpoint
DROP TABLE `dutyTimeSlots`;--> statement-breakpoint
ALTER TABLE `userProfiles` DROP COLUMN `canInspect`;