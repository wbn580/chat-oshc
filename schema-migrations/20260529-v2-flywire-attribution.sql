-- chat-oshc-leads D1 migration: v1 → v2 Flywire Hybrid
-- Migration: 20260529-v2-flywire-attribution
-- Drops Cohort Go three-fold attribution fields (partner, agent_organisation_id, cookie)
-- Adds Flywire referral tracking fields
--
-- Run with: wrangler d1 execute chat-oshc-leads --file=schema-migrations/20260529-v2-flywire-attribution.sql

-- 1. Add new Flywire referral fields (D1 supports ALTER TABLE ADD COLUMN)
ALTER TABLE sessions ADD COLUMN flywire_referrer TEXT NOT NULL DEFAULT '0df195ef-7f4d-4faf-82e2-1878faa84597';
ALTER TABLE sessions ADD COLUMN utm_campaign TEXT;
ALTER TABLE sessions ADD COLUMN referral_clicked_at INTEGER;
ALTER TABLE sessions ADD COLUMN referral_target_provider TEXT;

-- 2. Backfill utm_campaign for existing sessions (set to session id)
UPDATE sessions SET utm_campaign = id WHERE utm_campaign IS NULL;

-- 3. Drop old Cohort Go attribution columns (D1 doesn't support DROP COLUMN directly;
--    we set them to NULL and they'll be ignored by v2 code. If D1 later supports DROP,
--    a Phase 2 migration should drop them.)
--    Columns: partner, agent_organisation_id, cookie_set_at, cookie_expires_at
--    These were never populated in the initial schema.sql (they were planned but not created),
--    so this migration is a no-op for those columns.
