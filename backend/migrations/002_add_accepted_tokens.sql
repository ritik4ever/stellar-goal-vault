-- 002_add_accepted_tokens: multi-token campaigns and campaign integrity triggers.
--
-- Existing campaigns were XLM-only, so they default to '["XLM"]'. The CHECK is
-- enforced on fresh rows; the triggers below apply the full #868 invariant set
-- (including accepted_tokens_json) on every insert and update.

ALTER TABLE campaigns
  ADD COLUMN accepted_tokens_json TEXT NOT NULL DEFAULT '["XLM"]'
  CHECK(length(trim(accepted_tokens_json)) > 0);

CREATE TRIGGER campaigns_persistence_integrity_insert
BEFORE INSERT ON campaigns
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.creator IS NULL OR length(trim(NEW.creator)) = 0
      THEN RAISE(ABORT, 'campaigns.creator must be non-empty')
    WHEN NEW.title IS NULL OR length(trim(NEW.title)) = 0
      THEN RAISE(ABORT, 'campaigns.title must be non-empty')
    WHEN NEW.description IS NULL OR length(trim(NEW.description)) = 0
      THEN RAISE(ABORT, 'campaigns.description must be non-empty')
    WHEN NEW.accepted_tokens_json IS NULL OR length(trim(NEW.accepted_tokens_json)) = 0
      THEN RAISE(ABORT, 'campaigns.accepted_tokens_json must be non-empty')
    WHEN NEW.target_amount IS NULL OR NEW.target_amount <= 0
      THEN RAISE(ABORT, 'campaigns.target_amount must be > 0')
    WHEN NEW.pledged_amount IS NULL OR NEW.pledged_amount < 0
      THEN RAISE(ABORT, 'campaigns.pledged_amount must be >= 0')
    WHEN NEW.deadline IS NULL OR NEW.deadline <= 0
      THEN RAISE(ABORT, 'campaigns.deadline must be > 0')
    WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
      THEN RAISE(ABORT, 'campaigns.created_at must be > 0')
    WHEN NEW.claimed_at IS NOT NULL AND NEW.failed_at IS NOT NULL
      THEN RAISE(ABORT, 'campaigns cannot be both claimed and failed')
    WHEN NEW.max_per_contributor IS NOT NULL AND NEW.max_per_contributor < 0
      THEN RAISE(ABORT, 'campaigns.max_per_contributor must be >= 0')
  END;
END;

CREATE TRIGGER campaigns_persistence_integrity_update
BEFORE UPDATE ON campaigns
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.creator IS NULL OR length(trim(NEW.creator)) = 0
      THEN RAISE(ABORT, 'campaigns.creator must be non-empty')
    WHEN NEW.title IS NULL OR length(trim(NEW.title)) = 0
      THEN RAISE(ABORT, 'campaigns.title must be non-empty')
    WHEN NEW.description IS NULL OR length(trim(NEW.description)) = 0
      THEN RAISE(ABORT, 'campaigns.description must be non-empty')
    WHEN NEW.accepted_tokens_json IS NULL OR length(trim(NEW.accepted_tokens_json)) = 0
      THEN RAISE(ABORT, 'campaigns.accepted_tokens_json must be non-empty')
    WHEN NEW.target_amount IS NULL OR NEW.target_amount <= 0
      THEN RAISE(ABORT, 'campaigns.target_amount must be > 0')
    WHEN NEW.pledged_amount IS NULL OR NEW.pledged_amount < 0
      THEN RAISE(ABORT, 'campaigns.pledged_amount must be >= 0')
    WHEN NEW.deadline IS NULL OR NEW.deadline <= 0
      THEN RAISE(ABORT, 'campaigns.deadline must be > 0')
    WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
      THEN RAISE(ABORT, 'campaigns.created_at must be > 0')
    WHEN NEW.claimed_at IS NOT NULL AND NEW.failed_at IS NOT NULL
      THEN RAISE(ABORT, 'campaigns cannot be both claimed and failed')
    WHEN NEW.max_per_contributor IS NOT NULL AND NEW.max_per_contributor < 0
      THEN RAISE(ABORT, 'campaigns.max_per_contributor must be >= 0')
  END;
END;
