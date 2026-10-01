-- 005_add_pledges_integrity_constraints: pledge data-integrity triggers.
--
-- The pledges table was created without CHECK constraints. Application code
-- has always enforced a safe subset of invariants (positive amount, non-empty
-- contributor and asset_code, positive created_at), but bypassing the HTTP
-- layer allowed invalid rows to be inserted.
--
-- SQLite cannot add CHECK constraints via ALTER TABLE, so we mirror the same
-- invariant set with BEFORE INSERT / BEFORE UPDATE triggers following the
-- pattern established by migration 002 for the campaigns table.
--
-- Safe subset enforced here (all rules are already satisfied by existing valid
-- data so no historical rows need repair):
--
--   amount        > 0
--   contributor   non-empty (after trim)
--   asset_code    non-empty (after trim)
--   created_at    > 0
--   refunded_at   > 0 when NOT NULL

CREATE TRIGGER pledges_persistence_integrity_insert
BEFORE INSERT ON pledges
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.amount IS NULL OR NEW.amount <= 0
      THEN RAISE(ABORT, 'pledges.amount must be > 0')
    WHEN NEW.contributor IS NULL OR length(trim(NEW.contributor)) = 0
      THEN RAISE(ABORT, 'pledges.contributor must be non-empty')
    WHEN NEW.asset_code IS NULL OR length(trim(NEW.asset_code)) = 0
      THEN RAISE(ABORT, 'pledges.asset_code must be non-empty')
    WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
      THEN RAISE(ABORT, 'pledges.created_at must be > 0')
    WHEN NEW.refunded_at IS NOT NULL AND NEW.refunded_at <= 0
      THEN RAISE(ABORT, 'pledges.refunded_at must be > 0 when set')
  END;
END;

CREATE TRIGGER pledges_persistence_integrity_update
BEFORE UPDATE ON pledges
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.amount IS NULL OR NEW.amount <= 0
      THEN RAISE(ABORT, 'pledges.amount must be > 0')
    WHEN NEW.contributor IS NULL OR length(trim(NEW.contributor)) = 0
      THEN RAISE(ABORT, 'pledges.contributor must be non-empty')
    WHEN NEW.asset_code IS NULL OR length(trim(NEW.asset_code)) = 0
      THEN RAISE(ABORT, 'pledges.asset_code must be non-empty')
    WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
      THEN RAISE(ABORT, 'pledges.created_at must be > 0')
    WHEN NEW.refunded_at IS NOT NULL AND NEW.refunded_at <= 0
      THEN RAISE(ABORT, 'pledges.refunded_at must be > 0 when set')
  END;
END;
